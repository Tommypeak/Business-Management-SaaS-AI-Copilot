import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
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
import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import {
  CUSTOMER_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  SALES_STATUSES,
  type CustomerType,
  type PaymentMethod,
  type PaymentStatus,
  type SalesStatus,
} from '@saas/types';
import { MONEY_PATTERN } from '../catalog/catalog.dto.js';
import { HistoryQueryDto, NoteDto, QUANTITY_PATTERN } from '../inventory/inventory.dto.js';
import { trim } from '../organizations/organization.dto.js';
const lower = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;
const optional = () => ValidateIf((_object: unknown, value: unknown) => value !== undefined);
export class CustomerDto {
  @ApiProperty({ enum: CUSTOMER_TYPES }) @IsIn(CUSTOMER_TYPES) type!: CustomerType;
  @ApiProperty({ maxLength: 200 }) @Transform(trim) @IsString() @Length(1, 200) name!: string;
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
  @Length(1, 50)
  phone?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
  @ApiPropertyOptional() @optional() @IsBoolean() isActive?: boolean;
}
export class UpdateCustomerDto extends PartialType(CustomerDto, { skipNullProperties: false }) {}
export class CustomerQueryDto extends OmitType(HistoryQueryDto, [
  'type',
  'locationId',
  'variantId',
  'from',
  'to',
] as const) {
  @ApiPropertyOptional() @optional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: CUSTOMER_TYPES })
  @optional()
  @IsIn(CUSTOMER_TYPES)
  type?: CustomerType;
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @optional()
  @IsIn(['true', 'false'])
  isActive?: string;
}
export class OrderMetadataDto extends NoteDto {
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @Transform(lower)
  @IsUUID()
  customerId?: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @Transform(lower)
  @IsUUID()
  locationId?: string | null;
}
export class OrderItemDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() variantId!: string;
  @ApiProperty({ type: String, pattern: QUANTITY_PATTERN.source })
  @IsString()
  @Matches(QUANTITY_PATTERN)
  quantity!: string;
  @ApiPropertyOptional({ type: String, pattern: MONEY_PATTERN.source, default: '0.0000' })
  @IsString()
  @Matches(MONEY_PATTERN)
  discountAmount = '0.0000';
}
export class ReplaceItemsDto {
  @ApiProperty({ type: [OrderItemDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((item: OrderItemDto) => item.variantId)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}
export class CreateOrderDto extends OrderMetadataDto {
  @ApiPropertyOptional({ type: [OrderItemDto], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((item: OrderItemDto) => item.variantId)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[] = [];
}
export class PaymentDto extends NoteDto {
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) method!: PaymentMethod;
  @ApiProperty({ type: String, pattern: MONEY_PATTERN.source })
  @IsString()
  @Matches(MONEY_PATTERN)
  amount!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reference?: string | null;
}
export class CompleteOrderDto {
  @ApiPropertyOptional({ type: [PaymentDto], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PaymentDto)
  payments: PaymentDto[] = [];
}
export class SalesQueryDto extends OmitType(HistoryQueryDto, ['type', 'variantId'] as const) {
  @ApiPropertyOptional() @optional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: SALES_STATUSES })
  @optional()
  @IsIn(SALES_STATUSES)
  status?: SalesStatus;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(lower)
  @IsUUID()
  customerId?: string;
  @ApiPropertyOptional({ enum: PAYMENT_STATUSES })
  @optional()
  @IsIn(PAYMENT_STATUSES)
  paymentStatus?: PaymentStatus;
}
