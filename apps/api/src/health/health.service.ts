import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@saas/types';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  live(): HealthResponse {
    return { status: 'ok', service: 'api' };
  }

  async ready(): Promise<HealthResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const checks = Promise.all([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);
      const [, pong] = await Promise.race([
        checks,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Readiness timeout')), 5000);
        }),
      ]);
      if (pong !== 'PONG') throw new Error('Redis not ready');
      return this.live();
    } catch {
      throw new ServiceUnavailableException({ status: 'error', service: 'api' });
    } finally {
      clearTimeout(timer);
    }
  }
}
