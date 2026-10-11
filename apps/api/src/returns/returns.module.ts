import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ReturnsCommandsService } from './commands.service.js';
import { ReturnsQueryService } from './query.service.js';
import { ReturnsController } from './returns.controller.js';
@Module({
  imports: [PrismaModule, AuthorizationModule, InventoryModule],
  providers: [ReturnsCommandsService, ReturnsQueryService],
  controllers: [ReturnsController],
  exports: [ReturnsQueryService],
})
export class ReturnsModule {}
