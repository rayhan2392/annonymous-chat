# Architecture & Scaling Strategy

## Architecture Overview

The application is built with NestJS and uses distinct layers to handle REST HTTP requests and real-time WebSocket connections independently, unified by Redis and PostgreSQL via Drizzle ORM.

- **Client -> REST API (`/api/v1`):** Handles authentication (`POST /login`), room management (`GET/POST/DELETE /rooms`), and message sending (`POST /rooms/:id/messages`). Uses standard HTTP Request/Response cycles with Bearer token validation.
- **Client -> WebSocket (`/chat`):** Real-time event gateway for broadcasting messages and user presence updates to connected clients. Strictly read/subscribe model for message consumption.
- **PostgreSQL (via Drizzle ORM):** Source of truth for persistent data:
  - `users` table: user profiles with auto-generated IDs (`usr_*`)
  - `rooms` table: chat rooms with creator tracking and cascade delete on messages
  - `messages` table: message history with pagination support via cursor-based pagination
- **Redis:** Three-tier usage:
  - **Session Storage:** Bearer tokens map to user IDs with 24-hour TTL
  - **Active User Tracking:** Redis Sets store connected usernames per room (`room:{roomId}:users`)
  - **Pub/Sub Broker:** Central `chat-events` channel for cross-instance message broadcasting and room deletion events

## Session Strategy

Passwordless, opaque token-based authentication system:

1. **Generation:** `POST /login` with username creates or finds user and generates a 32-character opaque token via `nanoid(32)`.
2. **Storage:** Token stored in Redis as `session:{token}` → `userId` with 86,400 second (24-hour) TTL.
3. **Validation:** All protected REST endpoints use `AuthGuard` to validate Bearer token against Redis; WebSocket connections extract token from query parameters (`?token=...`) and validate before allowing room join.
4. **Performance:** Session validation is sub-millisecond, completely bypassing PostgreSQL lookup.

## Data Models

- **Users:** `id` (PK: `usr_*`), `username` (unique, max 24 chars), `createdAt`
- **Rooms:** `id` (PK: `room_*`), `name` (unique, max 32 chars), `createdBy` (userId), `createdAt`
- **Messages:** `id` (PK: `msg_*`), `roomId` (FK with cascade delete), `username`, `content` (max 1000 chars), `createdAt`

## WebSocket Event Flow & Redis Pub/Sub

Implements a fan-out architecture to support horizontal scaling:

### Message Broadcasting

1. Client calls `POST /rooms/:id/messages` with message content.
2. REST handler persists message to PostgreSQL via Drizzle ORM.
3. Handler publishes event to Redis `chat-events` channel: `{ type: 'message:new', roomId, payload: message }`.
4. Every active server instance's gateway subscribes to `chat-events`.
5. On receiving message event, gateway broadcasts to local Socket.io clients in `roomId` via `server.to(roomId).emit('message:new', payload)`.

### Room Deletion Flow

1. `DELETE /rooms/:id` deletes room and cascades message deletion in PostgreSQL.
2. Handler publishes `{ type: 'room:deleted', roomId }` to Redis.
3. All gateway instances receive event and:
   - Emit `room:deleted` event to clients in that room
   - Force disconnect all clients in the room via `disconnectSockets()`

### Presence Management

- **Join:** Client connects to `/chat?token=X&roomId=Y`, gateway adds username to `room:{roomId}:users` Redis Set, emits `room:joined` (to joining client) and `room:user_joined` (broadcast to others).
- **Leave:** On disconnect, gateway removes username from Set and broadcasts `room:user_left` with updated active users list.
- **Active Count:** GET `/rooms/:id` returns active user count by calling `SCARD room:{roomId}:users`.

## Message Pagination

`GET /rooms/:id/messages` implements cursor-based pagination:

- Default limit: 50 messages (max: 100)
- Optional `before` query parameter for cursor
- Returns messages in chronological order (oldest first) plus `hasMore` and `nextCursor` for client pagination

## WebSocket Events Contract

**Client to Server:**

- `room:leave` - Gracefully disconnect from room (triggers `handleDisconnect`)

**Server to Client:**

- `room:joined` - Sent on successful connection, includes active users list
- `room:user_joined` - Broadcast when another user joins
- `room:user_left` - Broadcast when user disconnects
- `message:new` - New message in room (via Redis Pub/Sub)
- `room:deleted` - Room was deleted, clients forcefully disconnected
- `error` - Authentication or room validation failures

## Estimated Concurrent User Capacity (Single Instance)

Assuming a standard 1vCPU / 512MB RAM instance:

- **Memory constraints:** Each active Socket.io connection uses ~30-50KB of RAM.
- **Capacity:** A single 512MB instance could safely maintain **~5,000 to 8,000 concurrent WebSocket connections** before memory pressure triggers garbage collection lag.
- **Primary bottleneck:** Node.js CPU thread blocking during mass serialization if thousands of users in the _same_ room send messages simultaneously; Redis Pub/Sub can handle event volume, but Socket.io broadcasting becomes CPU-bound.
- **Secondary bottleneck:** PostgreSQL connection pool exhaustion if configured too low; pooling via PgBouncer or built-in connection limits prevents database overload.

## Scaling to 10x Load (50K-100K Concurrent Users)

Recommended architecture changes:

1. **Horizontal Pod Autoscaling:** Deploy 5-10 NestJS instances behind a load balancer. No sticky sessions required (Redis handles all state).
2. **Redis Pub/Sub Adapter:** Already implemented via `@socket.io/redis-adapter`; Socket.io uses Redis for inter-instance communication.
3. **PostgreSQL Connection Pooling:** Implement PgBouncer in transaction mode to pool connections and prevent connection exhaustion.
4. **Message Queueing (Optional):** For extreme scale, instead of synchronous REST message inserts:
   - Push messages to Redis Stream or RabbitMQ queue from REST handler
   - Background worker (separate process) batch-inserts to PostgreSQL
   - Keeps REST response time flat regardless of database load
5. **Database Read Replicas:** If read load becomes bottleneck, add PostgreSQL replicas for message history queries.

## Known Limitations & Trade-offs

- **REST for Sending Messages:** `POST /rooms/:id/messages` enforces HTTP overhead (headers, SSL handshake, JSON serialization) per message vs. direct WebSocket emit. Deliberate trade-off to maintain strict REST API contract.
- **Orphaned Room Active Users:** If a server crashes without graceful shutdown, usernames remain in Redis `room:{roomId}:users` Sets. No automatic cleanup exists. Production solution: implement cron job to TTL these keys or use Redis key expiration patterns.
- **Message Content Validation:** Message length capped at 1000 characters; no rich text, markdown, or inline media support.
- **Username Immutability:** Usernames are permanent after creation; no edit or delete capability for user profiles.
- **Room Naming Collision:** Room names are globally unique; no namespacing or user-owned room separation.
- **No Message Editing:** Messages are immutable after creation; only deletion via room deletion cascade.
