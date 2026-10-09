import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { Permission } from '@saas/types';
import type { OrganizationContext } from '../auth/auth-context.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { CanonicalUuidPipe } from '../common/canonical-uuid.pipe.js';
import { CategoryDto, CategoryQueryDto, UpdateCategoryDto } from './expenses.dto.js';
import { ExpenseCategoriesService } from './categories.service.js';

@ApiTags('Expense Categories')
@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId/expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly categories: ExpenseCategoriesService) {}

  @Get()
  @RequirePermissions(Permission.EXPENSES_VIEW)
  list(@CurrentOrganization() tenant: OrganizationContext, @Query() query: CategoryQueryDto) {
    return this.categories.list(tenant.organizationId, query);
  }

  @Get(':categoryId')
  @RequirePermissions(Permission.EXPENSES_VIEW)
  get(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('categoryId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.categories.get(tenant.organizationId, id);
  }

  @Post()
  @RequirePermissions(Permission.EXPENSES_MANAGE)
  create(@CurrentOrganization() tenant: OrganizationContext, @Body() input: CategoryDto) {
    return this.categories.create(tenant.organizationId, input);
  }

  @Patch(':categoryId')
  @RequirePermissions(Permission.EXPENSES_MANAGE)
  update(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('categoryId', new CanonicalUuidPipe()) id: string,
    @Body() input: UpdateCategoryDto,
  ) {
    return this.categories.update(tenant.organizationId, id, input);
  }
}
