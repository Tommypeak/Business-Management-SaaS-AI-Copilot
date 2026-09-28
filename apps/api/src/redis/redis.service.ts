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

  onModuleDestroy(): void {
    if (this.client.isOpen) this.client.destroy();
  }
}
