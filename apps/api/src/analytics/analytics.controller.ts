import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Permission } from '@saas/types';
import type { OrganizationContext } from '../auth/auth-context.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { AnalyticsQueryDto } from './analytics.dto.js';
import { AnalyticsService } from './analytics.service.js';
import { SalesAnalyticsService } from './sales-analytics.service.js';
import { InventoryAnalyticsService } from './inventory-analytics.service.js';
import { PurchasingAnalyticsService } from './purchasing-analytics.service.js';
import { FinanceAnalyticsService } from './finance-analytics.service.js';
import { ReturnsAnalyticsService } from './returns-analytics.service.js';
import { analyticsSchemas as schemas } from './analytics.schemas.js';
@ApiTags('Analytics')
@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@RequirePermissions(Permission.ANALYTICS_VIEW)
@Controller('organizations/:organizationId/analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly sales: SalesAnalyticsService,
    private readonly inventory: InventoryAnalyticsService,
    private readonly purchasing: PurchasingAnalyticsService,
    private readonly finance: FinanceAnalyticsService,
    private readonly returns: ReturnsAnalyticsService,
  ) {}
  @Get('overview')
  @ApiOperation({ summary: 'Executive operational counts. Requires analytics.view.' })
  @ApiOkResponse({ schema: schemas.overview })
  overview(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.analytics.overview(t.organizationId, q);
  }
  @Get('returns/summary')
  @RequirePermissions(Permission.ANALYTICS_VIEW, Permission.RETURNS_VIEW)
  @ApiOperation({
    summary:
      'Posted return events and refund cash by business date; money is masked without finance.view.',
  })
  returnsSummary(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.returns.summary(
      t.organizationId,
      q,
      t.permissions.includes(Permission.FINANCE_VIEW),
    );
  }
  @Get('sales/summary')
  @RequirePermissions(Permission.ANALYTICS_VIEW, Permission.FINANCE_VIEW)
  @ApiOperation({
    summary:
      'Sales metrics and previous-period comparison. Requires analytics.view + finance.view.',
  })
  @ApiOkResponse({ schema: schemas.sales })
  salesSummary(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.sales.summary(t.organizationId, q);
  }
  @Get('sales/trend')
  @RequirePermissions(Permission.ANALYTICS_VIEW, Permission.FINANCE_VIEW)
  @ApiOperation({ summary: 'Zero-filled sales series. Requires analytics.view + finance.view.' })
  @ApiOkResponse({ schema: schemas.salesTrend })
  salesTrend(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.sales.trend(t.organizationId, q);
  }
  @Get('sales/top-variants')
  @RequirePermissions(Permission.ANALYTICS_VIEW, Permission.FINANCE_VIEW)
  @ApiOperation({
    summary:
      'Latest sale snapshots grouped by variant, unit and historical type. Requires analytics.view + finance.view.',
  })
  @ApiOkResponse({ schema: schemas.top })
  top(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.sales.top(t.organizationId, q);
  }
  @Get('inventory/summary')
  @ApiOperation({
    summary: 'Current inventory and bounded movement ranking. Requires analytics.view.',
  })
  @ApiOkResponse({ schema: schemas.inventory })
  stock(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.inventory.summary(t.organizationId, q);
  }
  @Get('inventory/movements')
  @ApiOperation({
    summary: 'Ledger series per unit and transaction type. Requires analytics.view.',
  })
  @ApiOkResponse({ schema: schemas.movements })
  movements(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.inventory.movements(t.organizationId, q);
  }
  @Get('inventory/locations')
  @ApiOperation({ summary: 'Inventory by location; maximum 50 rows. Requires analytics.view.' })
  @ApiOkResponse({ schema: schemas.locations })
  locations(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.inventory.locations(t.organizationId, q);
  }
  @Get('purchasing/summary')
  @RequirePermissions(Permission.ANALYTICS_VIEW, Permission.FINANCE_VIEW)
  @ApiOperation({
    summary:
      'Non-cancelled ordered POs, receipts and suppliers. Requires analytics.view + finance.view.',
  })
  @ApiOkResponse({ schema: schemas.purchasing })
  purchaseSummary(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.purchasing.summary(t.organizationId, q);
  }
  @Get('purchasing/receiving')
  @ApiOperation({
    summary: 'Current line receiving progress for POs ordered in period. Requires analytics.view.',
  })
  @ApiOkResponse({ schema: schemas.receiving })
  receiving(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.purchasing.receiving(t.organizationId, q);
  }
  @Get('finance/summary')
  @RequirePermissions(Permission.ANALYTICS_VIEW, Permission.FINANCE_VIEW)
  @ApiOperation({
    summary:
      'Existing Finance summary with comparison and expense categories. Requires analytics.view + finance.view.',
  })
  @ApiOkResponse({ schema: schemas.finance })
  financeSummary(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.finance.summary(t.organizationId, q);
  }
  @Get('finance/cash-flow')
  @RequirePermissions(Permission.ANALYTICS_VIEW, Permission.FINANCE_VIEW)
  @ApiOperation({
    summary:
      'Cash series; supplier amounts are null for location filters. Requires analytics.view + finance.view.',
  })
  @ApiOkResponse({ schema: schemas.cashFlow })
  cashFlow(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.finance.cashFlow(t.organizationId, q);
  }
  @Get('activity')
  @ApiOperation({
    summary:
      'Bounded recording chronology filtered by source permissions. Requires analytics.view.',
  })
  @ApiOkResponse({ schema: schemas.activity })
  activity(@CurrentOrganization() t: OrganizationContext, @Query() q: AnalyticsQueryDto) {
    return this.analytics.activity(t, q);
  }
}
