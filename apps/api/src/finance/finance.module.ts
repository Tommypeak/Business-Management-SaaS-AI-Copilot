import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
