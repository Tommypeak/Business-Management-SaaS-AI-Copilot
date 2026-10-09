import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { ExpenseCategoriesController } from './categories.controller.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpenseCategoriesService } from './categories.service.js';
import { ExpensesCommandsService } from './commands.service.js';
import { ExpensesQueryService } from './query.service.js';

@Module({
  imports: [PrismaModule, AuthorizationModule],
  controllers: [ExpenseCategoriesController, ExpensesController],
  providers: [ExpenseCategoriesService, ExpensesCommandsService, ExpensesQueryService],
})
export class ExpensesModule {}
