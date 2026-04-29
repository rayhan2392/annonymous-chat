import { Injectable, Inject, ConflictException } from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { nanoid } from 'nanoid';

@Injectable()
export class RoomsService {
  constructor(@Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>) {}

  async createRoom(name: string, userId: string) {
    try {
      const newRoom = {
        id: `room_${nanoid(10)}`,
        name,
        createdBy: userId,
      };

      const result = await this.db
        .insert(schema.rooms)
        .values(newRoom)
        .returning();
      return result[0];
    } catch (error) {
      // PostgreSQL throws code 23505 if the room name already exists
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (error.code === '23505') {
        throw new ConflictException('Room name already exists');
      }
      throw error;
    }
  }
  async getAllRooms() {
    // Drizzle makes fetching all records incredibly simple
    return await this.db.query.rooms.findMany({
      orderBy: (rooms, { desc }) => [desc(rooms.createdAt)], // Newest rooms first
    });
  }
}
