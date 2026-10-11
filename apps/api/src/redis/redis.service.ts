import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import type { Environment } from '../config/environment.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client;

  constructor(config: ConfigService<Environment, true>) {
    this.client = createClient({
      url: config.get('REDIS_URL', { infer: true }),
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => (retries < 5 ? Math.min(200 * 2 ** retries, 3000) : false),
      },
    });
    this.client.on('error', () => this.logger.warn('Redis connection error'));
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async consumeAiQuota(org: string, user: string, hourly: number, daily: number): Promise<boolean> {
    const now = Date.now();
    const result = await this.client.eval(
      `
      local a = tonumber(redis.call('GET', KEYS[1]) or '0')
      local b = tonumber(redis.call('GET', KEYS[2]) or '0')
      if a >= tonumber(ARGV[1]) or b >= tonumber(ARGV[2]) then return 0 end
      redis.call('INCR', KEYS[1]); redis.call('PEXPIRE', KEYS[1], ARGV[3])
      redis.call('INCR', KEYS[2]); redis.call('PEXPIRE', KEYS[2], ARGV[4])
      return 1`,
      {
        keys: [
          `ai:{${org}}:user:${user}:${Math.floor(now / 3600000)}`,
          `ai:{${org}}:day:${Math.floor(now / 86400000)}`,
        ],
        arguments: [String(hourly), String(daily), '3600000', '86400000'],
      },
    );
    return result === 1;
  }

  onModuleDestroy(): void {
    if (this.client.isOpen) this.client.destroy();
  }
}
