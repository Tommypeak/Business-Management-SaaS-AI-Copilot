import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { AccountsPayableModule } from '../accounts-payable/accounts-payable.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { AiConfig } from './ai.config.js';
import { AiAccessService } from './ai-access.service.js';
import { AiProviderClient } from './ai-provider.client.js';
import { AiToolsService } from './ai-tools.service.js';
import { AiService } from './ai.service.js';
import { AiController } from './ai.controller.js';
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthorizationModule,
    AnalyticsModule,
    FinanceModule,
    AccountsPayableModule,
    InventoryModule,
  ],
  providers: [AiConfig, AiAccessService, AiProviderClient, AiToolsService, AiService],
  controllers: [AiController],
})
export class AiModule {}
