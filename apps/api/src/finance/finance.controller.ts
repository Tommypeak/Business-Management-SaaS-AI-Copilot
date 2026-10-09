import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { Permission } from '@saas/types';
import type { OrganizationContext } from '../auth/auth-context.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { FinanceQueryDto } from '../expenses/expenses.dto.js';
import { FinanceService } from './finance.service.js';

@ApiTags('Finance')
@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId/finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('summary')
  @RequirePermissions(Permission.FINANCE_VIEW)
  summary(@CurrentOrganization() tenant: OrganizationContext, @Query() query: FinanceQueryDto) {
    return this.finance.summary(tenant.organizationId, query);
  }

  @Get('expenses-by-category')
  @RequirePermissions(Permission.FINANCE_VIEW)
  expensesByCategory(
    @CurrentOrganization() tenant: OrganizationContext,
    @Query() query: FinanceQueryDto,
  ) {
    return this.finance.expensesByCategory(tenant.organizationId, query);
  }
}
