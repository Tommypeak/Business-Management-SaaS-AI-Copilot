import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Permission } from '@saas/types';
import type { LocalUser, OrganizationContext } from '../auth/auth-context.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { CanonicalUuidPipe } from '../common/canonical-uuid.pipe.js';
import { IdempotencyKey, idempotencyHeader } from '../common/idempotency-key.decorator.js';
import { ReturnsCommandsService } from './commands.service.js';
import { ReturnsQueryService } from './query.service.js';
import { returnsSchemas as schemas } from './returns.schemas.js';
import {
  CancelReturnDto,
  CreateRefundDto,
  CreateReturnDto,
  PostReturnDto,
  RefundQueryDto,
  ReturnItemsDto,
  ReturnMetadataDto,
  ReturnQueryDto,
} from './returns.dto.js';
@ApiTags('Customer Returns & Refunds')
@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId')
export class ReturnsController {
  constructor(
    private readonly commands: ReturnsCommandsService,
    private readonly queries: ReturnsQueryService,
  ) {}
  @Get('returns')
  @ApiOkResponse({ schema: schemas.list })
  @RequirePermissions(Permission.RETURNS_VIEW)
  list(@CurrentOrganization() ctx: OrganizationContext, @Query() q: ReturnQueryDto) {
    return this.queries.list(ctx, q);
  }
  @Get('returns/:returnId')
  @ApiOkResponse({ schema: schemas.detail })
  @RequirePermissions(Permission.RETURNS_VIEW)
  get(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('returnId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.queries.get(ctx, id);
  }
  @Post('returns')
  @ApiCreatedResponse({ schema: schemas.detail })
  @RequirePermissions(Permission.RETURNS_MANAGE)
  @ApiHeader(idempotencyHeader)
  create(
    @CurrentOrganization() ctx: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: CreateReturnDto,
  ) {
    return this.commands.create(ctx, user.id, key, input);
  }
  @Patch('returns/:returnId')
  @ApiOkResponse({ schema: schemas.detail })
  @RequirePermissions(Permission.RETURNS_MANAGE)
  update(
    @CurrentOrganization() ctx: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @Param('returnId', new CanonicalUuidPipe()) id: string,
    @Body() input: ReturnMetadataDto,
  ) {
    return this.commands.update(ctx, user.id, id, input);
  }
  @Put('returns/:returnId/items')
  @ApiOkResponse({ schema: schemas.detail })
  @RequirePermissions(Permission.RETURNS_MANAGE)
  items(
    @CurrentOrganization() ctx: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @Param('returnId', new CanonicalUuidPipe()) id: string,
    @Body() input: ReturnItemsDto,
  ) {
    return this.commands.update(ctx, user.id, id, input);
  }
  @Post('returns/:returnId/post')
  @ApiCreatedResponse({ schema: schemas.detail })
  @ApiOperation({
    summary:
      'Post proportional credits and restock atomically; original sale is immutable. Optional revision/expectedCredit detects stale previews.',
  })
  @RequirePermissions(Permission.RETURNS_MANAGE)
  @ApiHeader(idempotencyHeader)
  post(
    @CurrentOrganization() ctx: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @Param('returnId', new CanonicalUuidPipe()) id: string,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: PostReturnDto,
  ) {
    return this.commands.post(ctx, user.id, id, key, input);
  }
  @Post('returns/:returnId/cancel')
  @ApiCreatedResponse({ schema: schemas.detail })
  @RequirePermissions(Permission.RETURNS_MANAGE)
  @ApiHeader(idempotencyHeader)
  cancel(
    @CurrentOrganization() ctx: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @Param('returnId', new CanonicalUuidPipe()) id: string,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: CancelReturnDto,
  ) {
    return this.commands.cancel(ctx, user.id, id, key, input);
  }
  @Get('sales/orders/:orderId/returns')
  @ApiOkResponse({ schema: schemas.list })
  @RequirePermissions(Permission.RETURNS_VIEW)
  async orderReturns(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('orderId', new CanonicalUuidPipe()) id: string,
    @Query() q: ReturnQueryDto,
  ) {
    await this.queries.eligibility(ctx, id);
    return this.queries.list(ctx, { ...q, salesOrderId: id });
  }
  @Get('sales/orders/:orderId/return-eligibility')
  @ApiOkResponse({ schema: schemas.eligibility })
  @RequirePermissions(Permission.RETURNS_VIEW)
  eligibility(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('orderId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.queries.eligibility(ctx, id);
  }
  @Get('refunds')
  @ApiOkResponse({ schema: schemas.refunds })
  @RequirePermissions(Permission.RETURNS_VIEW)
  refunds(@CurrentOrganization() ctx: OrganizationContext, @Query() q: RefundQueryDto) {
    return this.queries.refunds(ctx, q);
  }
  @Get('refunds/:refundId')
  @ApiOkResponse({ schema: schemas.refund })
  @RequirePermissions(Permission.RETURNS_VIEW)
  refund(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param('refundId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.queries.refund(ctx, id);
  }
  @Post('refunds')
  @ApiCreatedResponse({ schema: schemas.refund })
  @ApiOperation({
    summary:
      'Record an actual payout, with allocations to posted returns from one sale. Caps: recorded cash minus refunds; unused credit per return.',
  })
  @RequirePermissions(Permission.REFUNDS_MANAGE)
  @ApiHeader(idempotencyHeader)
  pay(
    @CurrentOrganization() ctx: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @IdempotencyKey(new CanonicalUuidPipe()) key: string,
    @Body() input: CreateRefundDto,
  ) {
    return this.commands.refund(ctx, user.id, key, input);
  }
}
