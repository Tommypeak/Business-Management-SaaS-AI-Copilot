import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { OrdersQueryService } from './orders-query.service.js';
import { PaymentsService } from './payments.service.js';
@Module({
  imports: [PrismaModule, AuthorizationModule, InventoryModule],
  controllers: [CustomersController, OrdersController],
  providers: [CustomersService, OrdersService, OrdersQueryService, PaymentsService],
})
export class SalesModule {}
