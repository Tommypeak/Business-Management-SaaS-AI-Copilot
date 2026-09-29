import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  CATALOG_ITEM_TYPES,
  CATALOG_SORTS,
  CUSTOM_FIELD_TYPES,
  UNITS,
  type CatalogItemType,
  type CatalogSort,
  type CustomFieldType,
  type UnitOfMeasure,
} from '@saas/types';
import { trim } from '../organizations/organization.dto.js';

const optional = () => ValidateIf((_object: unknown, value: unknown) => value !== undefined);
const identifier = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() || null : value;
const sku = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() || null : value;
export const MONEY_PATTERN = /^(0|[1-9]\d{0,14})(\.\d{1,4})?$/;

export class VariantDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @Transform(identifier)
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 80 })
  @Transform(sku)
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9._/-]{0,79}$/)
  sku?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @Transform(identifier)
  @IsOptional()
  @IsString()
  @Length(1, 120)
  barcode?: string | null;

  @ApiProperty({ type: String, example: '1234567890.1234', pattern: MONEY_PATTERN.source })
  @IsString()
  @Matches(MONEY_PATTERN)
  sellingPrice!: string;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: MONEY_PATTERN.source })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN)
  costPrice?: string | null;

  @ApiProperty({ enum: UNITS })
  @IsIn(UNITS)
  unit!: UnitOfMeasure;

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @optional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  optionValueIds?: string[];

  @ApiPropertyOptional()
  @optional()
  @IsBoolean()
  isActive?: boolean;
}
export class UpdateVariantDto extends PartialType(VariantDto, { skipNullProperties: false }) {}

export class CustomValueDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fieldId!: string;
  @ApiProperty({
    description:
      'Definition-validated value: string (TEXT/NUMBER/DATE/SELECT), boolean, string[] (MULTI_SELECT), or null to clear.',
    nullable: true,
    oneOf: [{ type: 'string' }, { type: 'boolean' }, { type: 'array', items: { type: 'string' } }],
  })
  @Allow()
  value!: unknown;
}
export class CreateItemDto {
  @ApiProperty({ enum: CATALOG_ITEM_TYPES })
  @IsIn(CATALOG_ITEM_TYPES)
  type!: CatalogItemType;
  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 5000 })
  @Transform(identifier)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;
  @ApiPropertyOptional({ default: false })
  @optional()
  @IsBoolean()
  trackInventory?: boolean;
  @ApiProperty({ type: VariantDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => VariantDto)
  defaultVariant!: VariantDto;
  @ApiPropertyOptional({ type: [CustomValueDto], maxItems: 100 })
  @optional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CustomValueDto)
  customFields?: CustomValueDto[];
}
export class UpdateItemDto extends PartialType(
  OmitType(CreateItemDto, ['defaultVariant'] as const),
  { skipNullProperties: false },
) {
  @ApiPropertyOptional()
  @optional()
  @IsBoolean()
  isActive?: boolean;
}

export class CatalogQueryDto {
  @ApiPropertyOptional({ maxLength: 2048 })
  @optional()
  @IsString()
  @Length(1, 2048)
  cursor?: string;
  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
  @ApiPropertyOptional({ maxLength: 100 })
  @optional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional({ enum: CATALOG_ITEM_TYPES })
  @optional()
  @IsIn(CATALOG_ITEM_TYPES)
  type?: CatalogItemType;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @IsUUID()
  categoryId?: string;
  @ApiPropertyOptional({ default: true })
  @optional()
  @Transform(({ value }: TransformFnParams): unknown =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;
  @ApiPropertyOptional({ enum: CATALOG_SORTS, default: 'createdAt' })
  @IsIn(CATALOG_SORTS)
  sort: CatalogSort = 'createdAt';
}

export class CategoryDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
  @ApiPropertyOptional()
  @optional()
  @IsBoolean()
  isActive?: boolean;
}
export class UpdateCategoryDto extends PartialType(CategoryDto, { skipNullProperties: false }) {}

export class OptionDto {
  @ApiProperty({ maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name!: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @optional()
  @IsInt()
  @Min(0)
  @Max(10000)
  position?: number;
  @ApiPropertyOptional()
  @optional()
  @IsBoolean()
  isActive?: boolean;
}
export class UpdateOptionDto extends PartialType(OptionDto, { skipNullProperties: false }) {}
export class OptionValueDto extends OmitType(OptionDto, ['name'] as const) {
  @ApiProperty({ maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  value!: string;
}
export class UpdateOptionValueDto extends PartialType(OptionValueDto, {
  skipNullProperties: false,
}) {}

export class FieldOptionDto extends OptionValueDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  label!: string;
}
export class UpdateFieldOptionDto extends PartialType(
  OmitType(FieldOptionDto, ['value'] as const),
  { skipNullProperties: false },
) {}
export class FieldDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;
  @ApiProperty({ pattern: '^[a-z][a-z0-9_]{0,63}$' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{0,63}$/)
  key!: string;
  @ApiProperty({ enum: CUSTOM_FIELD_TYPES })
  @IsIn(CUSTOM_FIELD_TYPES)
  type!: CustomFieldType;
  @ApiPropertyOptional()
  @optional()
  @IsBoolean()
  isRequired?: boolean;
  @ApiPropertyOptional({ type: [FieldOptionDto], maxItems: 100 })
  @optional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => FieldOptionDto)
  options?: FieldOptionDto[];
}
export class UpdateFieldDto extends PartialType(
  OmitType(FieldDto, ['key', 'type', 'options'] as const),
  { skipNullProperties: false },
) {
  @ApiPropertyOptional()
  @optional()
  @IsBoolean()
  isActive?: boolean;
}
