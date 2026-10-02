import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { Environment } from '../config/environment.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly sqlSchema: Prisma.Sql;
  constructor(config: ConfigService<Environment, true>) {
    const connectionString = config.get('DATABASE_URL', { infer: true });
    super({
      adapter: new PrismaPg(
        {
          connectionString,
          connectionTimeoutMillis: 5000,
          query_timeout: 5000,
          max: 10,
        },
        { schema: new URL(connectionString).searchParams.get('schema') ?? 'public' },
      ),
    });
    // SQL identifier from trusted server configuration, quoted independently of HTTP values.
    const schema = new URL(connectionString).searchParams.get('schema') ?? 'public';
    this.sqlSchema = Prisma.raw(`"${schema.replaceAll('"', '""')}"`);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
