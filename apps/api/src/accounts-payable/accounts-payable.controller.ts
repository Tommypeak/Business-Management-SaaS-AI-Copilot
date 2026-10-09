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
  CreateSupplierBillDto,
  CreateSupplierPaymentDto,
  SupplierBillQueryDto,
  SupplierPaymentQueryDto,
  UpdateSupplierBillDto,
  VoidSupplierBillDto,
} from './accounts-payable.dto.js';
import { AccountsPayableCommandsService } from './commands.service.js';
import { AccountsPayableQueryService } from './query.service.js';

@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId/accounts-payable')
export class AccountsPayableController {
  constructor(
    private readonly commands: AccountsPayableCommandsService,
    private readonly queries: AccountsPayableQueryService,
  ) {}

  @Get('bills')
  @ApiTags('Supplier Bills')
  @RequirePermissions(Permission.ACCOUNTS_PAYABLE_VIEW)
  list(@CurrentOrganization() tenant: OrganizationContext, @Query() query: SupplierBillQueryDto) {
    return this.queries.list(tenant.organizationId, query);
  }

  @Get('bills/:billId')
  @ApiTags('Supplier Bills')
  @RequirePermissions(Permission.ACCOUNTS_PAYABLE_VIEW)
  get(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('billId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.queries.get(tenant.organizationId, id);
  }

  @Post('bills')
  @ApiTags('Supplier Bills')
  @RequirePermissions(Permission.ACCOUNTS_PAYABLE_MANAGE)
  @ApiHeader(idempotencyHeader)
  create(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: CreateSupplierBillDto,
  ) {
    return this.commands.create(tenant.organizationId, user.id, key, input);
  }

  @Patch('bills/:billId')
  @ApiTags('Supplier Bills')
  @RequirePermissions(Permission.ACCOUNTS_PAYABLE_MANAGE)
  update(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('billId', new CanonicalUuidPipe()) id: string,
    @Body() input: UpdateSupplierBillDto,
  ) {
    return this.commands.update(tenant.organizationId, id, input);
  }

  @Post('bills/:billId/post')
  @ApiTags('Supplier Bills')
  @RequirePermissions(Permission.ACCOUNTS_PAYABLE_MANAGE)
  @ApiHeader(idempotencyHeader)
  post(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('billId', new CanonicalUuidPipe()) id: string,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
  ) {
    return this.commands.post(tenant.organizationId, id, key);
  }

  @Post('bills/:billId/void')
  @ApiTags('Supplier Bills')
  @RequirePermissions(Permission.ACCOUNTS_PAYABLE_MANAGE)
  @ApiHeader(idempotencyHeader)
  void(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @Param('billId', new CanonicalUuidPipe()) id: string,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: VoidSupplierBillDto,
  ) {
    return this.commands.void(tenant.organizationId, user.id, id, key, input);
  }

  @Get('bills/:billId/payments')
  @ApiTags('Supplier Payments')
  @RequirePermissions(Permission.ACCOUNTS_PAYABLE_VIEW)
  payments(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('billId', new CanonicalUuidPipe()) id: string,
    @Query() query: SupplierPaymentQueryDto,
  ) {
    return this.queries.payments(tenant.organizationId, id, query);
  }

  @Post('bills/:billId/payments')
  @ApiTags('Supplier Payments')
  @RequirePermissions(Permission.ACCOUNTS_PAYABLE_PAYMENTS_MANAGE)
  @ApiHeader(idempotencyHeader)
  pay(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @Param('billId', new CanonicalUuidPipe()) id: string,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: CreateSupplierPaymentDto,
  ) {
    return this.commands.pay(tenant.organizationId, user.id, id, key, input);
  }

  @Get('summary')
  @ApiTags('Accounts Payable Summary')
  @RequirePermissions(Permission.ACCOUNTS_PAYABLE_VIEW)
  summary(@CurrentOrganization() tenant: OrganizationContext) {
    return this.queries.summary(tenant.organizationId);
  }
}
