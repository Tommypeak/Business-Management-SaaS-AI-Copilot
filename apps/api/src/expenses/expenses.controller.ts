import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiParam, ApiTags } from '@nestjs/swagger';
import { Permission } from '@saas/types';
import type { LocalUser, OrganizationContext } from '../auth/auth-context.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { CanonicalUuidPipe } from '../common/canonical-uuid.pipe.js';
import { IdempotencyKey, idempotencyHeader } from '../common/idempotency-key.decorator.js';
import {
  CreateExpenseDto,
  ExpenseQueryDto,
  UpdateExpenseDto,
  VoidExpenseDto,
} from './expenses.dto.js';
import { ExpensesCommandsService } from './commands.service.js';
import { ExpensesQueryService } from './query.service.js';

@ApiTags('Expenses')
@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId/expenses')
export class ExpensesController {
  constructor(
    private readonly commands: ExpensesCommandsService,
    private readonly queries: ExpensesQueryService,
  ) {}

  @Get()
  @RequirePermissions(Permission.EXPENSES_VIEW)
  list(@CurrentOrganization() tenant: OrganizationContext, @Query() query: ExpenseQueryDto) {
    return this.queries.list(tenant.organizationId, query);
  }

  @Get(':expenseId')
  @RequirePermissions(Permission.EXPENSES_VIEW)
  get(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('expenseId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.queries.get(tenant.organizationId, id);
  }

  @Post()
  @RequirePermissions(Permission.EXPENSES_MANAGE)
  @ApiHeader(idempotencyHeader)
  create(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: CreateExpenseDto,
  ) {
    return this.commands.create(tenant.organizationId, user.id, key, input);
  }

  @Patch(':expenseId')
  @RequirePermissions(Permission.EXPENSES_MANAGE)
  update(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('expenseId', new CanonicalUuidPipe()) id: string,
    @Body() input: UpdateExpenseDto,
  ) {
    return this.commands.update(tenant.organizationId, id, input);
  }

  @Post(':expenseId/post')
  @RequirePermissions(Permission.EXPENSES_MANAGE)
  @ApiHeader(idempotencyHeader)
  post(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('expenseId', new CanonicalUuidPipe()) id: string,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
  ) {
    return this.commands.post(tenant.organizationId, id, key);
  }

  @Post(':expenseId/void')
  @RequirePermissions(Permission.EXPENSES_MANAGE)
  @ApiHeader(idempotencyHeader)
  void(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @Param('expenseId', new CanonicalUuidPipe()) id: string,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: VoidExpenseDto,
  ) {
    return this.commands.void(tenant.organizationId, user.id, id, key, input);
  }
}
