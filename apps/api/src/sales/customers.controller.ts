import { CanonicalUuidPipe } from '../common/canonical-uuid.pipe.js';
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { Permission } from '@saas/types';
import type { OrganizationContext } from '../auth/auth-context.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { CustomersService } from './customers.service.js';
import { CustomerDto, CustomerQueryDto, UpdateCustomerDto } from './sales.dto.js';
@ApiTags('Customers')
@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}
  @Get()
  @RequirePermissions(Permission.CUSTOMERS_VIEW)
  list(@CurrentOrganization() tenant: OrganizationContext, @Query() query: CustomerQueryDto) {
    return this.customers.list(tenant.organizationId, query);
  }
  @Get(':customerId')
  @RequirePermissions(Permission.CUSTOMERS_VIEW)
  get(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('customerId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.customers.get(tenant.organizationId, id);
  }
  @Post()
  @RequirePermissions(Permission.CUSTOMERS_MANAGE)
  create(@CurrentOrganization() tenant: OrganizationContext, @Body() input: CustomerDto) {
    return this.customers.create(tenant.organizationId, input);
  }
  @Patch(':customerId')
  @RequirePermissions(Permission.CUSTOMERS_MANAGE)
  update(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('customerId', new CanonicalUuidPipe()) id: string,
    @Body() input: UpdateCustomerDto,
  ) {
    return this.customers.update(tenant.organizationId, id, input);
  }
}
