import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AccountsPayableController } from './accounts-payable.controller.js';
import { AccountsPayableCommandsService } from './commands.service.js';
import { AccountsPayableQueryService } from './query.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [AccountsPayableController],
  exports: [AccountsPayableQueryService],
  providers: [AccountsPayableCommandsService, AccountsPayableQueryService],
})
export class AccountsPayableModule {}
