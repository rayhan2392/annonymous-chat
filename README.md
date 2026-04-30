# Anonymous Chat API

A real-time, scalable anonymous group chat API built for high concurrency. Users can join rooms and exchange messages instantly without passwords or registration.

## Tech Stack
* **Framework:** NestJS
* **Database:** PostgreSQL (Neon)
* **ORM:** Drizzle ORM
* **Caching & Pub/Sub:** Upstash Redis
* **WebSockets:** Socket.io (with Redis Adapter)

## Local Setup Instructions

### 1. Environment Variables
Create a `.env` file in the root directory and add the following:

\`\`\`env
DATABASE_URL="your_postgresql_connection_string"
REDIS_URL="your_redis_connection_string"
JWT_SECRET="your_super_secret_jwt_string"
PORT=3000
\`\`\`

### 2. Installation
Install the project dependencies:
\`\`\`bash
npm install
\`\`\`

### 3. Database Schema Push
Push the Drizzle schema to your PostgreSQL database to create the `users`, `rooms`, and `messages` tables:
\`\`\`bash
npx drizzle-kit push:pg
\`\`\`

### 4. Running the Application
Start the development server:
\`\`\`bash
npm run start:dev
\`\`\`
The REST API will be available at `http://localhost:3000/api/v1` and the WebSocket gateway at `ws://localhost:3000/chat`.