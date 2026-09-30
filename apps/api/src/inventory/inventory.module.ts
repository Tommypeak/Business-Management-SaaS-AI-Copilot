import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryCommandsService } from './commands.service.js';
import { InventoryStockService } from './stock.service.js';
import { InventoryTransactionsService } from './transactions.service.js';
import { InventorySettingsService } from './settings.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [InventoryController],
  providers: [
    InventoryCommandsService,
    InventoryStockService,
    InventoryTransactionsService,
    InventorySettingsService,
  ],
})
export class InventoryModule {}
