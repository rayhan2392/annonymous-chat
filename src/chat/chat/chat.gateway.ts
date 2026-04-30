/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { Inject, OnModuleInit } from '@nestjs/common';

import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { eq } from 'drizzle-orm';
import Redis from 'ioredis'; // To interact with Upstash directly for room counts
import { RedisService } from 'src/redis/redis.service';
import { DRIZZLE } from 'src/database/database.module';
import * as schema from 'src/database/schema';

// 1. CONTRACT: Connect to the /chat namespace
@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  private redisClient: Redis;
  private redisSubscriber: Redis;

  constructor(
    private redisService: RedisService,
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
  ) {
    // We need a direct redis client for managing sets (active users)
    this.redisClient = new Redis(process.env.REDIS_URL as string);
    this.redisSubscriber = new Redis(process.env.REDIS_URL as string);
  }

  onModuleInit() {
    this.redisSubscriber.subscribe('chat-events', (err) => {
      if (err) console.error('Failed to subscribe to chat-events', err);
    });

    this.redisSubscriber.on('message', (channel, message) => {
      if (channel === 'chat-events') {
        const event = JSON.parse(message);

        if (event.type === 'message:new') {
          // Broadcast to everyone in the room!
          this.server.to(event.roomId).emit('message:new', event.payload);
        } else if (event.type === 'room:deleted') {
          this.server
            .to(event.roomId)
            .emit('room:deleted', { roomId: event.roomId });
          this.server.in(event.roomId).disconnectSockets(); // Force disconnect them
        }
      }
    });
  }

  async handleConnection(client: Socket) {
    try {
      // 2. CONTRACT: token and roomId as query parameters
      const token = client.handshake.query.token as string;
      const roomId = client.handshake.query.roomId as string;

      if (!token) {
        client.emit('error', { code: '401', message: 'Unauthorized' });
        return client.disconnect();
      }
      if (!roomId) {
        client.emit('error', { code: '404', message: 'Room not found' });
        return client.disconnect();
      }

      // Validate Token
      const userId = await this.redisService.getSession(token);
      if (!userId) {
        client.emit('error', { code: '401', message: 'Unauthorized' });
        return client.disconnect();
      }

      // Fetch User to get Username
      const user = await this.db.query.users.findFirst({
        where: eq(schema.users.id, userId),
      });

      if (!user) return client.disconnect();

      // Attach data to socket
      client.data.userId = userId;
      client.data.username = user.username;
      client.data.roomId = roomId;

      // Join the socket.io room
      client.join(roomId);

      // 3. CONTRACT: Redis Active User Tracking
      // Add username to a Redis Set for this specific room
      await this.redisClient.sadd(`room:${roomId}:users`, user.username);

      // Get all active users in the room
      const activeUsers = await this.redisClient.smembers(
        `room:${roomId}:users`,
      );

      // 4. CONTRACT: Emit specific events
      // Emit to the connecting client ONLY
      client.emit('room:joined', { activeUsers });

      // Broadcast to everyone ELSE in the room
      client
        .to(roomId)
        .emit('room:user_joined', { username: user.username, activeUsers });

      console.log(`${user.username} joined ${roomId}`);
    } catch (error) {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const { username, roomId } = client.data;
    if (username && roomId) {
      // Remove from Redis Set
      await this.redisClient.srem(`room:${roomId}:users`, username);
      const activeUsers = await this.redisClient.smembers(
        `room:${roomId}:users`,
      );

      // CONTRACT: room:user_left
      this.server.to(roomId).emit('room:user_left', { username, activeUsers });
    }
  }

  // CONTRACT: Client emits room:leave for graceful disconnect
  @SubscribeMessage('room:leave')
  async handleLeaveRoom(@ConnectedSocket() client: Socket) {
    client.disconnect(); // This will trigger handleDisconnect automatically
  }
}
