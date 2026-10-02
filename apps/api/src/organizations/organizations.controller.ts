import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { LocalUser, OrganizationContext } from '../auth/auth-context.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { Permission } from '../authorization/permissions.js';
import { ListQueryDto } from '../common/list-query.dto.js';
import { CreateOrganizationDto, UpdateOrganizationDto } from './organization.dto.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}
  @Get()
  list(@CurrentUser() user: LocalUser, @Query() query: ListQueryDto) {
    return this.organizations.list(user.id, query);
  }
  @Post()
  create(@CurrentUser() user: LocalUser, @Body() input: CreateOrganizationDto) {
    return this.organizations.create(user.id, input);
  }
}

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId')
export class OrganizationController {
  constructor(private readonly organizations: OrganizationsService) {}
  @Get()
  @RequirePermissions(Permission.ORGANIZATION_VIEW)
  get(@CurrentOrganization() tenant: OrganizationContext) {
    return this.organizations.get(tenant.organizationId, tenant);
  }
  @Patch()
  @RequirePermissions(Permission.ORGANIZATION_UPDATE)
  update(@CurrentOrganization() tenant: OrganizationContext, @Body() input: UpdateOrganizationDto) {
    return this.organizations.update(tenant.organizationId, input);
  }
  @Get('members')
  @RequirePermissions(Permission.MEMBERS_VIEW)
  members(@CurrentOrganization() tenant: OrganizationContext, @Query() query: ListQueryDto) {
    return this.organizations.members(tenant.organizationId, query);
  }
  @Get('roles')
  @RequirePermissions(Permission.ROLES_VIEW)
  roles(@CurrentOrganization() tenant: OrganizationContext, @Query() query: ListQueryDto) {
    return this.organizations.roles(tenant.organizationId, query);
  }
}
