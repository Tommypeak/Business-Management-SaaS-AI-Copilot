import { Module } from '@nestjs/common';
import { EnvironmentModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { LocationsModule } from './locations/locations.module.js';

@Module({
  imports: [EnvironmentModule, HealthModule, AuthModule, OrganizationsModule, LocationsModule],
})
export class AppModule {}
