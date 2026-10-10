import { Module } from '@nestjs/common';
import { EnvironmentModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { SalesModule } from './sales/sales.module.js';
import { PurchasingModule } from './purchasing/purchasing.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { AccountsPayableModule } from './accounts-payable/accounts-payable.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';

@Module({
  imports: [
    EnvironmentModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    LocationsModule,
    CatalogModule,
    InventoryModule,
    SalesModule,
    PurchasingModule,
    ExpensesModule,
    FinanceModule,
    AccountsPayableModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
