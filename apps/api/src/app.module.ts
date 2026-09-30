import { Module } from '@nestjs/common';
import { EnvironmentModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { InventoryModule } from './inventory/inventory.module.js';

@Module({
  imports: [
    EnvironmentModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    LocationsModule,
    CatalogModule,
    InventoryModule,
  ],
})
export class AppModule {}
