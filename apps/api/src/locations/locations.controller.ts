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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { OrganizationContext } from '../auth/auth-context.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { Permission } from '../authorization/permissions.js';
import { ListQueryDto } from '../common/list-query.dto.js';
import { CreateLocationDto, UpdateLocationDto } from './location.dto.js';
import { LocationsService } from './locations.service.js';

@ApiTags('Locations')
@ApiBearerAuth()
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId/locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}
  @Get()
  @RequirePermissions(Permission.LOCATIONS_VIEW)
  list(@CurrentOrganization() tenant: OrganizationContext, @Query() query: ListQueryDto) {
    return this.locations.list(tenant.organizationId, query);
  }
  @Post()
  @RequirePermissions(Permission.LOCATIONS_MANAGE)
  create(@CurrentOrganization() tenant: OrganizationContext, @Body() input: CreateLocationDto) {
    return this.locations.create(tenant.organizationId, input);
  }
  @Patch(':locationId')
  @RequirePermissions(Permission.LOCATIONS_MANAGE)
  update(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('locationId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateLocationDto,
  ) {
    return this.locations.update(tenant.organizationId, id, input);
  }
}
