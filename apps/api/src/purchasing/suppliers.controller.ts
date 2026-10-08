import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { Permission } from '@saas/types';
import type { OrganizationContext } from '../auth/auth-context.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { CanonicalUuidPipe } from '../common/canonical-uuid.pipe.js';
import { SupplierDto, SupplierQueryDto, UpdateSupplierDto } from './purchasing.dto.js';
import { SuppliersService } from './suppliers.service.js';

@ApiTags('Suppliers')
@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId/suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}
  @Get()
  @RequirePermissions(Permission.SUPPLIERS_VIEW)
  list(@CurrentOrganization() tenant: OrganizationContext, @Query() q: SupplierQueryDto) {
    return this.suppliers.list(tenant.organizationId, q);
  }
  @Get(':supplierId')
  @RequirePermissions(Permission.SUPPLIERS_VIEW)
  get(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('supplierId', new CanonicalUuidPipe()) id: string,
  ) {
    return this.suppliers.get(tenant.organizationId, id);
  }
  @Post()
  @RequirePermissions(Permission.SUPPLIERS_MANAGE)
  create(@CurrentOrganization() tenant: OrganizationContext, @Body() input: SupplierDto) {
    return this.suppliers.create(tenant.organizationId, input);
  }
  @Patch(':supplierId')
  @RequirePermissions(Permission.SUPPLIERS_MANAGE)
  update(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('supplierId', new CanonicalUuidPipe()) id: string,
    @Body() input: UpdateSupplierDto,
  ) {
    return this.suppliers.update(tenant.organizationId, id, input);
  }
}
