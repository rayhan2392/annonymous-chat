/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE } from '../database/database.module';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private db: NodePgDatabase<typeof schema>,
    private redis: RedisService,
  ) {}

  async login(username: string) {
    // 1. Find user or Create if they don't exist
    let user = await this.db.query.users.findFirst({
      where: eq(schema.users.username, username),
    });

    if (!user) {
      const newUser = {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        id: `usr_${nanoid(10)}`,
        username,
      };
      const result = await this.db
        .insert(schema.users)
        .values(newUser)
        .returning();
      user = result[0];
    }

    // 2. Create Opaque Session Token
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const sessionToken = nanoid(32);

    // 3. Store in Redis
    await this.redis.setSession(sessionToken, user.id);

    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      sessionToken,
      user,
    };
  }
}
