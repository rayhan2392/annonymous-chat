/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    // 1. Check for Bearer token
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or expired session token');
    }

    const token = authHeader.split(' ')[1];

    // 2. Look up the token in Upstash Redis
    const userId = await this.redisService.getSession(token);

    if (!userId) {
      throw new UnauthorizedException('Missing or expired session token');
    }

    // 3. Attach userId to the request (just like req.user = userId in Express!)
    request.user = { id: userId };
    return true; // Let the request pass to the Controller
  }
}
