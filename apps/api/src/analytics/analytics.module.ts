import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { SalesAnalyticsService } from './sales-analytics.service.js';
import { InventoryAnalyticsService } from './inventory-analytics.service.js';
import { PurchasingAnalyticsService } from './purchasing-analytics.service.js';
import { FinanceAnalyticsService } from './finance-analytics.service.js';
@Module({
  imports: [PrismaModule, AuthorizationModule, FinanceModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    SalesAnalyticsService,
    InventoryAnalyticsService,
    PurchasingAnalyticsService,
    FinanceAnalyticsService,
  ],
})
export class AnalyticsModule {}
