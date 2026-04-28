import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  onModuleInit() {
    // Connect to Upstash
    this.client = new Redis(process.env.REDIS_URL as string);
  }

  onModuleDestroy() {
    this.client.disconnect();
  }

  // Save session for 24 hours (86400 seconds)
  async setSession(token: string, userId: string): Promise<void> {
    await this.client.set(`session:${token}`, userId, 'EX', 86400);
  }

  // Get user ID from token
  async getSession(token: string): Promise<string | null> {
    return await this.client.get(`session:${token}`);
  }
}
