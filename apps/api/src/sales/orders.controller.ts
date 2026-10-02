import { CanonicalUuidPipe } from '../common/canonical-uuid.pipe.js';
import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiParam, ApiTags } from '@nestjs/swagger';
import { Permission } from '@saas/types';
import type { LocalUser, OrganizationContext } from '../auth/auth-context.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { IdempotencyKey, idempotencyHeader } from '../common/idempotency-key.decorator.js';
import {
  CompleteOrderDto,
  CreateOrderDto,
  OrderMetadataDto,
  PaymentDto,
  ReplaceItemsDto,
  SalesQueryDto,
} from './sales.dto.js';
import { OrdersService } from './orders.service.js';
import { OrdersQueryService } from './orders-query.service.js';
import { PaymentsService } from './payments.service.js';
@ApiTags('Sales Orders')
@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId/sales/orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly queries: OrdersQueryService,
    private readonly payments: PaymentsService,
  ) {}
  @Get()
  @RequirePermissions(Permission.SALES_VIEW)
  list(@CurrentOrganization() tenant: OrganizationContext, @Query() query: SalesQueryDto) {
    return this.queries.list(tenant.organizationId, query);
  }
  @Get(':orderId')
  @RequirePermissions(Permission.SALES_VIEW)
  get(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('orderId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.queries.get(tenant.organizationId, id);
  }
  @Post()
  @RequirePermissions(Permission.SALES_CREATE)
  @ApiHeader(idempotencyHeader)
  create(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: CreateOrderDto,
  ) {
    return this.orders.create(tenant.organizationId, user.id, key, input);
  }
  @Patch(':orderId')
  @RequirePermissions(Permission.SALES_MANAGE)
  update(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('orderId', new CanonicalUuidPipe()) id: string,
    @Body() input: OrderMetadataDto,
  ) {
    return this.orders.update(tenant.organizationId, id, input);
  }
  @Put(':orderId/items')
  @RequirePermissions(Permission.SALES_MANAGE)
  items(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('orderId', new CanonicalUuidPipe()) id: string,
    @Body() input: ReplaceItemsDto,
  ) {
    return this.orders.replace(tenant.organizationId, id, input.items);
  }
  @Post(':orderId/cancel')
  @RequirePermissions(Permission.SALES_MANAGE)
  cancel(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('orderId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.orders.cancel(tenant.organizationId, id);
  }
  @Post(':orderId/complete')
  @RequirePermissions(Permission.SALES_COMPLETE)
  @ApiHeader(idempotencyHeader)
  complete(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @Param('orderId', new CanonicalUuidPipe()) id: string,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: CompleteOrderDto,
  ) {
    return this.orders.complete(tenant, user.id, id, key, input);
  }
  @Get(':orderId/payments')
  @RequirePermissions(Permission.SALES_VIEW)
  @ApiTags('Payments')
  async listPayments(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('orderId', new CanonicalUuidPipe()) id: string,
  ) {
    return (await this.queries.get(tenant.organizationId, id)).payments;
  }
  @Post(':orderId/payments')
  @RequirePermissions(Permission.SALES_PAYMENTS_MANAGE)
  @ApiHeader(idempotencyHeader)
  @ApiTags('Payments')
  addPayment(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @Param('orderId', new CanonicalUuidPipe()) id: string,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: PaymentDto,
  ) {
    return this.payments.add(tenant.organizationId, user.id, id, key, input);
  }
}
