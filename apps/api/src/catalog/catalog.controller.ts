import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import type { OrganizationContext } from '../auth/auth-context.js';
import { CurrentOrganization } from '../authorization/current-organization.decorator.js';
import { OrganizationMembershipGuard } from '../authorization/organization-membership.guard.js';
import { PermissionsGuard, RequirePermissions } from '../authorization/permissions.guard.js';
import { Permission } from '../authorization/permissions.js';
import { ListQueryDto } from '../common/list-query.dto.js';
import {
  CatalogQueryDto,
  CreateItemDto,
  UpdateItemDto,
  VariantDto,
  UpdateVariantDto,
  CategoryDto,
  UpdateCategoryDto,
  OptionDto,
  UpdateOptionDto,
  OptionValueDto,
  UpdateOptionValueDto,
  FieldDto,
  UpdateFieldDto,
  FieldOptionDto,
  UpdateFieldOptionDto,
} from './catalog.dto.js';
import { CatalogService } from './catalog.service.js';
import { CategoriesService } from './categories.service.js';
import { VariantsService } from './variants.service.js';
import { CustomFieldsService } from './custom-fields.service.js';

@ApiTags('Catalog')
@ApiBearerAuth()
@ApiParam({ name: 'organizationId', format: 'uuid' })
@UseGuards(OrganizationMembershipGuard, PermissionsGuard)
@Controller('organizations/:organizationId/catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly categories: CategoriesService,
    private readonly variants: VariantsService,
    private readonly fields: CustomFieldsService,
  ) {}
  @Get('items')
  @RequirePermissions(Permission.CATALOG_VIEW)
  items(@CurrentOrganization() tenant: OrganizationContext, @Query() query: CatalogQueryDto) {
    return this.catalog.list(tenant.organizationId, query);
  }

  @Post('items')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  createItem(@CurrentOrganization() tenant: OrganizationContext, @Body() input: CreateItemDto) {
    return this.catalog.create(tenant.organizationId, input);
  }

  @Get('items/:itemId')
  @RequirePermissions(Permission.CATALOG_VIEW)
  item(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ) {
    return this.catalog.get(tenant.organizationId, itemId);
  }

  @Patch('items/:itemId')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  updateItem(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() input: UpdateItemDto,
  ) {
    return this.catalog.update(tenant.organizationId, itemId, input);
  }

  @Get('items/:itemId/variants')
  @RequirePermissions(Permission.CATALOG_VIEW)
  variantsList(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Query() query: ListQueryDto,
  ) {
    return this.variants.list(tenant.organizationId, itemId, query);
  }

  @Post('items/:itemId/variants')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  createVariant(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() input: VariantDto,
  ) {
    return this.variants.create(tenant.organizationId, itemId, input);
  }

  @Patch('items/:itemId/variants/:variantId')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  updateVariant(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
    @Body() input: UpdateVariantDto,
  ) {
    return this.variants.update(tenant.organizationId, itemId, variantId, input);
  }

  @Get('items/:itemId/options')
  @RequirePermissions(Permission.CATALOG_VIEW)
  options(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
  ) {
    return this.variants.options(tenant.organizationId, itemId);
  }

  @Post('items/:itemId/options')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  createOption(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Body() input: OptionDto,
  ) {
    return this.variants.createOption(tenant.organizationId, itemId, input);
  }

  @Patch('items/:itemId/options/:optionId')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  updateOption(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Param('optionId', new ParseUUIDPipe()) optionId: string,
    @Body() input: UpdateOptionDto,
  ) {
    return this.variants.updateOption(tenant.organizationId, itemId, optionId, input);
  }

  @Post('items/:itemId/options/:optionId/values')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  createOptionValue(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Param('optionId', new ParseUUIDPipe()) optionId: string,
    @Body() input: OptionValueDto,
  ) {
    return this.variants.createOptionValue(tenant.organizationId, itemId, optionId, input);
  }

  @Patch('items/:itemId/options/:optionId/values/:valueId')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  updateOptionValue(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @Param('optionId', new ParseUUIDPipe()) optionId: string,
    @Param('valueId', new ParseUUIDPipe()) valueId: string,
    @Body() input: UpdateOptionValueDto,
  ) {
    return this.variants.updateOptionValue(tenant.organizationId, itemId, optionId, valueId, input);
  }

  @Get('categories')
  @RequirePermissions(Permission.CATALOG_VIEW)
  categoriesList(@CurrentOrganization() tenant: OrganizationContext, @Query() query: ListQueryDto) {
    return this.categories.list(tenant.organizationId, query);
  }

  @Post('categories')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  createCategory(@CurrentOrganization() tenant: OrganizationContext, @Body() input: CategoryDto) {
    return this.categories.create(tenant.organizationId, input);
  }

  @Patch('categories/:categoryId')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  updateCategory(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
    @Body() input: UpdateCategoryDto,
  ) {
    return this.categories.update(tenant.organizationId, categoryId, input);
  }

  @Get('custom-fields')
  @RequirePermissions(Permission.CATALOG_VIEW)
  fieldsList(@CurrentOrganization() tenant: OrganizationContext, @Query() query: ListQueryDto) {
    return this.fields.list(tenant.organizationId, query);
  }

  @Post('custom-fields')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  createField(@CurrentOrganization() tenant: OrganizationContext, @Body() input: FieldDto) {
    return this.fields.create(tenant.organizationId, input);
  }

  @Patch('custom-fields/:fieldId')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  updateField(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('fieldId', new ParseUUIDPipe()) fieldId: string,
    @Body() input: UpdateFieldDto,
  ) {
    return this.fields.update(tenant.organizationId, fieldId, input);
  }

  @Post('custom-fields/:fieldId/options')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  createFieldOption(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('fieldId', new ParseUUIDPipe()) fieldId: string,
    @Body() input: FieldOptionDto,
  ) {
    return this.fields.createOption(tenant.organizationId, fieldId, input);
  }

  @Patch('custom-fields/:fieldId/options/:optionId')
  @RequirePermissions(Permission.CATALOG_MANAGE)
  updateFieldOption(
    @CurrentOrganization() tenant: OrganizationContext,
    @Param('fieldId', new ParseUUIDPipe()) fieldId: string,
    @Param('optionId', new ParseUUIDPipe()) optionId: string,
    @Body() input: UpdateFieldOptionDto,
  ) {
    return this.fields.updateOption(tenant.organizationId, fieldId, optionId, input);
  }
}
