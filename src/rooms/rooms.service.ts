import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq, and, desc, lt } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import Redis from 'ioredis';

@Injectable()
export class RoomsService {
  private redisClient: Redis;

  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {
    this.redisClient = new Redis(process.env.REDIS_URL as string);
  }

  async createRoom(name: string, userId: string) {
    // Check if exists -> 409
    const existing = await this.db.query.rooms.findFirst({
      where: eq(schema.rooms.name, name),
    });
    if (existing) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'ROOM_NAME_TAKEN',
            message: 'A room with this name already exists',
          },
        },
        HttpStatus.CONFLICT,
      );
    }

    const newRoom = { id: `room_${nanoid(10)}`, name, createdBy: userId };
    const saved = await this.db
      .insert(schema.rooms)
      .values(newRoom)
      .returning();
    return saved[0];
  }

  async getAllRooms() {
    const rooms = await this.db.query.rooms.findMany();
    // Attach active users count from Redis
    const roomsWithCounts = await Promise.all(
      rooms.map(async (r) => {
        const count = await this.redisClient.scard(`room:${r.id}:users`);
        return { ...r, activeUsers: count };
      }),
    );
    return { rooms: roomsWithCounts };
  }

  async getRoom(id: string) {
    const room = await this.db.query.rooms.findFirst({
      where: eq(schema.rooms.id, id),
    });
    if (!room) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'ROOM_NOT_FOUND',
            message: `Room with id ${id} does not exist`,
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }
    const count = await this.redisClient.scard(`room:${id}:users`);
    return { ...room, activeUsers: count };
  }

  async deleteRoom(id: string, userId: string) {
    const room = await this.db.query.rooms.findFirst({
      where: eq(schema.rooms.id, id),
    });
    if (!room) {
      throw new HttpException(
        {
          success: false,
          error: { code: 'ROOM_NOT_FOUND', message: 'Room not found' },
        },
        HttpStatus.NOT_FOUND,
      );
    }
    if (room.createdBy !== userId) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Only the room creator can delete this room',
          },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Delete messages, then room
    await this.db.delete(schema.messages).where(eq(schema.messages.roomId, id));
    await this.db.delete(schema.rooms).where(eq(schema.rooms.id, id));

    // Publish to Redis so Gateways can drop connections
    await this.redisClient.publish(
      'chat-events',
      JSON.stringify({ type: 'room:deleted', roomId: id }),
    );

    return { deleted: true };
  }

  async getRoomMessages(
    roomId: string,
    limit: number = 50,
    beforeCursor?: string,
  ) {
    const room = await this.db.query.rooms.findFirst({
      where: eq(schema.rooms.id, roomId),
    });
    if (!room) {
      throw new HttpException(
        {
          success: false,
          error: { code: 'ROOM_NOT_FOUND', message: 'Room not found' },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const conditions = [eq(schema.messages.roomId, roomId)];
    if (beforeCursor) {
      conditions.push(lt(schema.messages.id, beforeCursor));
    }

    // Fetch limit + 1 to know if there's a next page
    const msgs = await this.db.query.messages.findMany({
      where: and(...conditions),
      orderBy: [desc(schema.messages.createdAt), desc(schema.messages.id)],
      limit: limit + 1,
    });

    const hasMore = msgs.length > limit;
    const messagesToReturn = hasMore ? msgs.slice(0, limit) : msgs;
    const nextCursor = hasMore
      ? messagesToReturn[messagesToReturn.length - 1].id
      : null;

    // Return in chronological order (oldest first for display)
    return { messages: messagesToReturn.reverse(), hasMore, nextCursor };
  }

  async sendMessage(roomId: string, userId: string, content: string) {
    if (!content || content.trim().length === 0 || content.length > 1000) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'MESSAGE_TOO_LONG',
            message: 'Message content must be 1-1000 characters',
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const room = await this.db.query.rooms.findFirst({
      where: eq(schema.rooms.id, roomId),
    });
    if (!room) {
      throw new HttpException(
        {
          success: false,
          error: { code: 'ROOM_NOT_FOUND', message: 'Room not found' },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });

    const newMessage = {
      id: `msg_${nanoid(10)}`,
      roomId,
      username: user!.username,
      content: content.trim(),
    };

    const saved = await this.db
      .insert(schema.messages)
      .values(newMessage)
      .returning();

    // Broadcast via Redis Pub/Sub (Gateways will listen to this)
    await this.redisClient.publish(
      'chat-events',
      JSON.stringify({ type: 'message:new', roomId, payload: saved[0] }),
    );

    return saved[0];
  }
}
