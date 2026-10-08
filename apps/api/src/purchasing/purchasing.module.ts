import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';
import { PurchasingOrdersController } from './orders.controller.js';
import { PurchasingOrdersService } from './orders.service.js';
import { PurchasingQueryService } from './query.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule, InventoryModule],
  controllers: [SuppliersController, PurchasingOrdersController],
  providers: [SuppliersService, PurchasingOrdersService, PurchasingQueryService],
})
export class PurchasingModule {}
