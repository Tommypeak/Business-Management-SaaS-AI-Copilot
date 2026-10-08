import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
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
  CreatePurchaseDto,
  CreateReceiptDto,
  PurchaseQueryDto,
  ReplacePurchaseItemsDto,
  UpdatePurchaseDto,
} from './purchasing.dto.js';
import { PurchasingOrdersService } from './orders.service.js';
import { PurchasingQueryService } from './query.service.js';

@ApiTags('Purchase Orders')
@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId/purchasing')
export class PurchasingOrdersController {
  constructor(
    private readonly orders: PurchasingOrdersService,
    private readonly queries: PurchasingQueryService,
  ) {}
  @Get('orders')
  @RequirePermissions(Permission.PURCHASING_VIEW)
  list(@CurrentOrganization() tenant: OrganizationContext, @Query() q: PurchaseQueryDto) {
    return this.queries.list(tenant.organizationId, q);
  }
  @Get('orders/:purchaseOrderId')
  @RequirePermissions(Permission.PURCHASING_VIEW)
  get(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('purchaseOrderId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.queries.get(tenant.organizationId, id);
  }
  @Post('orders')
  @RequirePermissions(Permission.PURCHASING_CREATE)
  @ApiHeader(idempotencyHeader)
  create(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: CreatePurchaseDto,
  ) {
    return this.orders.create(tenant.organizationId, user.id, key, input);
  }
  @Patch('orders/:purchaseOrderId')
  @RequirePermissions(Permission.PURCHASING_MANAGE)
  update(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('purchaseOrderId', new CanonicalUuidPipe()) id: string,
    @Body() input: UpdatePurchaseDto,
  ) {
    return this.orders.update(tenant.organizationId, id, input);
  }
  @Put('orders/:purchaseOrderId/items')
  @RequirePermissions(Permission.PURCHASING_MANAGE)
  replace(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('purchaseOrderId', new CanonicalUuidPipe()) id: string,
    @Body() input: ReplacePurchaseItemsDto,
  ) {
    return this.orders.replace(tenant.organizationId, id, input.items);
  }
  @Post('orders/:purchaseOrderId/order')
  @RequirePermissions(Permission.PURCHASING_MANAGE)
  @ApiHeader(idempotencyHeader)
  order(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('purchaseOrderId', new CanonicalUuidPipe()) id: string,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
  ) {
    return this.orders.order(tenant.organizationId, id, key);
  }
  @Post('orders/:purchaseOrderId/cancel')
  @RequirePermissions(Permission.PURCHASING_MANAGE)
  cancel(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('purchaseOrderId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.orders.cancel(tenant.organizationId, id);
  }
  @Get('orders/:purchaseOrderId/receipts')
  @RequirePermissions(Permission.PURCHASING_VIEW)
  @ApiTags('Goods Receipts')
  async receipts(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('purchaseOrderId', new CanonicalUuidPipe()) id: string,
  ) {
    return (await this.queries.get(tenant.organizationId, id)).receipts;
  }
  @Post('orders/:purchaseOrderId/receipts')
  @RequirePermissions(Permission.PURCHASING_RECEIVE)
  @ApiHeader(idempotencyHeader)
  @ApiTags('Goods Receipts')
  receive(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @Param('purchaseOrderId', new CanonicalUuidPipe()) id: string,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: CreateReceiptDto,
  ) {
    return this.orders.receive(tenant.organizationId, user.id, id, key, input);
  }
  @Get('receipts/:receiptId')
  @RequirePermissions(Permission.PURCHASING_VIEW)
  @ApiTags('Goods Receipts')
  receipt(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('receiptId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.queries.receipt(tenant.organizationId, id);
  }
}
