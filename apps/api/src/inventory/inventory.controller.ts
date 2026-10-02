import { IdempotencyKey, idempotencyHeader } from '../common/idempotency-key.decorator.js';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiParam, ApiTags } from '@nestjs/swagger';
import type { LocalUser, OrganizationContext } from '../auth/auth-context.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { Permission } from '../authorization/permissions.js';
import {
  AdjustmentDto,
  HistoryQueryDto,
  InventorySettingsDto,
  NoteDto,
  OpeningBalanceDto,
  StockQueryDto,
  TransferDto,
} from './inventory.dto.js';
import { InventoryCommandsService } from './commands.service.js';
import { InventoryStockService } from './stock.service.js';
import { InventoryTransactionsService } from './transactions.service.js';
import { InventorySettingsService } from './settings.service.js';

@ApiTags('Inventory')
@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId/inventory')
export class InventoryController {
  constructor(
    private readonly commands: InventoryCommandsService,
    private readonly stock: InventoryStockService,
    private readonly transactions: InventoryTransactionsService,
    private readonly settings: InventorySettingsService,
  ) {}
  @Get('stock')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  listStock(@CurrentOrganization() tenant: OrganizationContext, @Query() query: StockQueryDto) {
    return this.stock.list(tenant.organizationId, query);
  }
  @Get('transactions')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  history(@CurrentOrganization() tenant: OrganizationContext, @Query() query: HistoryQueryDto) {
    return this.transactions.list(tenant.organizationId, query);
  }
  @Get('transactions/:transactionId')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  detail(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('transactionId', new ParseUUIDPipe()) id: string,
  ) {
    return this.transactions.get(tenant.organizationId, id);
  }
  @Get('settings')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  getSettings(@CurrentOrganization() tenant: OrganizationContext) {
    return this.settings.get(tenant.organizationId);
  }
  @Patch('settings')
  @RequirePermissions(Permission.INVENTORY_SETTINGS_MANAGE)
  updateSettings(
    @CurrentOrganization() tenant: OrganizationContext,
    @Body() input: InventorySettingsDto,
  ) {
    return this.settings.update(tenant.organizationId, input);
  }
  @Post('opening-balances')
  @RequirePermissions(Permission.INVENTORY_ADJUST)
  @ApiHeader(idempotencyHeader)
  opening(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @IdempotencyKey(new ParseUUIDPipe()) key: string,
    @Body() input: OpeningBalanceDto,
  ) {
    return this.commands.opening(tenant.organizationId, user.id, key, input);
  }
  @Post('adjustments')
  @RequirePermissions(Permission.INVENTORY_ADJUST)
  @ApiHeader(idempotencyHeader)
  adjustment(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @IdempotencyKey(new ParseUUIDPipe()) key: string,
    @Body() input: AdjustmentDto,
  ) {
    return this.commands.adjustment(tenant.organizationId, user.id, key, input);
  }
  @Post('transfers')
  @RequirePermissions(Permission.INVENTORY_TRANSFER)
  @ApiHeader(idempotencyHeader)
  transfer(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @IdempotencyKey(new ParseUUIDPipe()) key: string,
    @Body() input: TransferDto,
  ) {
    return this.commands.transfer(tenant.organizationId, user.id, key, input);
  }
  // Permission to reverse follows the original command type, checked by the service.
  @Post('transactions/:transactionId/reverse')
  @RequirePermissions(Permission.INVENTORY_VIEW)
  @ApiHeader(idempotencyHeader)
  reverse(
    @CurrentOrganization() tenant: OrganizationContext,
    @CurrentUser() user: LocalUser,
    @IdempotencyKey(new ParseUUIDPipe()) key: string,
    @Param('transactionId', new ParseUUIDPipe()) id: string,
    @Body() input: NoteDto,
  ) {
    return this.commands.reverse(tenant, user.id, key, id, input);
  }
}
