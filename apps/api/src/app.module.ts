import { Module } from '@nestjs/common';
import { EnvironmentModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';

@Module({ imports: [EnvironmentModule, HealthModule] })
export class AppModule {}
