# Architecture & Scaling Strategy

## Architecture Overview
The application is decoupled into distinct layers to handle REST HTTP requests and real-time WebSocket connections independently, unified by Redis and PostgreSQL.

* **Client -> REST API (`/api/v1`):** Handles authentication, room creation, and message persistence. Uses standard HTTP Request/Response cycles.
* **Client -> WebSocket (`/chat`):** A strictly listen-only gateway (for messages) and connection state manager.
* **PostgreSQL (via Drizzle ORM):** The source of truth for persistent data (Users, Rooms, Messages). 
* **Redis:** Acts as the high-speed caching layer for sessions, active user sets, and the central message broker for Socket.io.

## Session Strategy
We implemented a passwordless, token-based authentication system.
1. **Generation:** When a user logs in, a secure JWT/Opaque token is generated.
2. **Storage:** The token is stored as a key in Redis with the `userId` as the value, featuring an explicit 24-hour expiration (TTL). 
3. **Validation:** Every REST endpoint and WebSocket connection intercepts the request, grabs the Bearer token, and checks Redis. This completely bypasses the need to query PostgreSQL for authentication, resulting in sub-millisecond session validation.

## WebSocket Fan-out via Redis Pub/Sub
To scale across multiple server instances, no single instance can hold the "master" list of connected clients in local memory.
1. When `POST /rooms/:id/messages` is called, Server A saves the message to PostgreSQL.
2. Server A then publishes a `message:new` event to a central Redis `chat-events` channel.
3. Every active server instance (Server A, Server B, Server C) subscribes to this Redis channel.
4. When the Redis message is received, each server checks its local Socket.io memory to see if it holds any clients connected to that specific `roomId`, and broadcasts the message only to them.

## Estimated Concurrent User Capacity (Single Instance)
Assuming a standard 1vCPU / 512MB RAM instance (e.g., Render Free/Hobby tier):
* **Memory constraints:** Each active Socket.io connection uses roughly 30-50KB of RAM. 
* **Capacity:** A single 512MB instance could safely maintain **~5,000 to 8,000 concurrent WebSocket connections** before memory pressure causes garbage collection lag.
* **Bottleneck:** The bottleneck would not be the database (since writes are quick and reads are paginated), but rather Node.js CPU thread blocking during mass-broadcast serialization if thousands of users are in the *same* room sending messages simultaneously.

## Scaling to 10x Load
If the application needed to support 50,000 - 100,000 concurrent users, I would implement the following:
1. **Horizontal Pod Autoscaling:** Spin up 5-10 Node.js instances behind a load balancer with sticky sessions disabled (since Redis handles our state).
2. **PostgreSQL Connection Pooling:** Implement PgBouncer to prevent our horizontal scaling from exhausting the database connection limit.
3. **Message Queueing:** Instead of writing to PostgreSQL synchronously during the REST request, I would push incoming messages to a Redis Stream or RabbitMQ/Kafka, and have a separate background worker batch-insert them into PostgreSQL. This keeps the REST endpoint response time completely flat regardless of database load.

## Known Limitations & Trade-offs
* **REST for Sending Messages:** Forcing users to use `POST` for sending messages instead of emitting directly via WebSockets introduces slight HTTP overhead (headers, SSL handshakes) per message compared to a pure full-duplex socket channel. This was a deliberate trade-off to enforce strict REST API contract compliance.
* **Orphaned Room Counts:** If a server crashes abruptly without running its `handleDisconnect` lifecycle hook, the user's name might remain stuck in the Redis Set for that room's active users. A cron job or TTL-based heartbeat mechanism would be needed in production to clean up "ghost" users in Redis.