import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { PURCHASE_STATUSES, type PurchaseStatus } from '@saas/types';
import { MONEY_PATTERN } from '../catalog/catalog.dto.js';
import { HistoryQueryDto, NoteDto, QUANTITY_PATTERN } from '../inventory/inventory.dto.js';
import { trim } from '../organizations/organization.dto.js';
const lower = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;
const optional = () => ValidateIf((_object: unknown, value: unknown) => value !== undefined);

export class SupplierDto {
  @ApiProperty({ maxLength: 200 }) @Transform(trim) @IsString() @Length(1, 200) name!: string;
  @ApiPropertyOptional({ nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
  @ApiPropertyOptional() @optional() @IsBoolean() isActive?: boolean;
}
export class UpdateSupplierDto extends PartialType(SupplierDto, { skipNullProperties: false }) {}
export class SupplierQueryDto extends OmitType(HistoryQueryDto, [
  'type',
  'locationId',
  'variantId',
  'from',
  'to',
] as const) {
  @ApiPropertyOptional() @optional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @optional()
  @IsIn(['true', 'false'])
  isActive?: string;
}
export class PurchaseMetadataDto extends NoteDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() supplierId!: string;
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() destinationLocationId!: string;
}
export class UpdatePurchaseDto extends PartialType(PurchaseMetadataDto, {
  skipNullProperties: false,
}) {}
export class PurchaseItemDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() variantId!: string;
  @ApiProperty({ type: String, pattern: QUANTITY_PATTERN.source })
  @IsString()
  @Matches(QUANTITY_PATTERN)
  orderedQuantity!: string;
  @ApiProperty({ type: String, pattern: MONEY_PATTERN.source })
  @IsString()
  @Matches(MONEY_PATTERN)
  unitCost!: string;
}
export class ReplacePurchaseItemsDto {
  @ApiProperty({ type: [PurchaseItemDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((i: PurchaseItemDto) => i.variantId)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items!: PurchaseItemDto[];
}
export class CreatePurchaseDto extends PurchaseMetadataDto {
  @ApiPropertyOptional({ type: [PurchaseItemDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((i: PurchaseItemDto) => i.variantId)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[] = [];
}
export class ReceiptItemDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() purchaseOrderItemId!: string;
  @ApiProperty({ type: String, pattern: QUANTITY_PATTERN.source })
  @IsString()
  @Matches(QUANTITY_PATTERN)
  quantity!: string;
}
export class CreateReceiptDto extends NoteDto {
  @ApiProperty({ type: [ReceiptItemDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((i: ReceiptItemDto) => i.purchaseOrderItemId)
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items!: ReceiptItemDto[];
}
export class PurchaseQueryDto extends OmitType(HistoryQueryDto, [
  'type',
  'variantId',
  'locationId',
] as const) {
  @ApiPropertyOptional() @optional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: PURCHASE_STATUSES })
  @optional()
  @IsIn(PURCHASE_STATUSES)
  status?: PurchaseStatus;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(lower)
  @IsUUID()
  supplierId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(lower)
  @IsUUID()
  destinationLocationId?: string;
}
