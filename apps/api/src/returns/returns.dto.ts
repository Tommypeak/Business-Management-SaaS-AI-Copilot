import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  PAYMENT_METHODS,
  RESTOCK_DISPOSITIONS,
  SALES_RETURN_STATUSES,
  type PaymentMethod,
  type RestockDisposition,
  type SalesReturnStatus,
} from '@saas/types';
import { MONEY_PATTERN } from '../catalog/catalog.dto.js';
import { QUANTITY_PATTERN } from '../inventory/inventory.dto.js';
import { IsBusinessDate } from '../expenses/expenses.dto.js';
import { trim } from '../organizations/organization.dto.js';
const lower = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;
export class ReturnMetadataDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  reason?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
export class ReturnItemDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() salesOrderItemId!: string;
  @ApiProperty({ type: String, pattern: QUANTITY_PATTERN.source })
  @IsString()
  @Matches(QUANTITY_PATTERN)
  quantity!: string;
  @ApiProperty({ enum: RESTOCK_DISPOSITIONS })
  @IsIn(RESTOCK_DISPOSITIONS)
  restockDisposition!: RestockDisposition;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @Transform(lower)
  @IsUUID()
  locationId?: string | null;
}
export class ReturnItemsDto {
  @ApiProperty({ type: [ReturnItemDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((i: ReturnItemDto) => i.salesOrderItemId)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];
}
export class CreateReturnDto extends ReturnMetadataDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() salesOrderId!: string;
  @ApiProperty({ type: [ReturnItemDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((i: ReturnItemDto) => i.salesOrderItemId)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];
}
export class PostReturnDto {
  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  revision?: number;
  @ApiPropertyOptional({ type: String, pattern: MONEY_PATTERN.source })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @Matches(MONEY_PATTERN)
  expectedCredit?: string;
}
export class CancelReturnDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  reason?: string | null;
}
export class ReturnQueryDto {
  @ApiPropertyOptional({ enum: SALES_RETURN_STATUSES })
  @IsOptional()
  @IsIn(SALES_RETURN_STATUSES)
  status?: SalesReturnStatus;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @Transform(lower)
  @IsUUID()
  salesOrderId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @Transform(lower)
  @IsUUID()
  customerId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @Transform(lower)
  @IsUUID()
  locationId?: string;
  @ApiPropertyOptional({
    format: 'date',
    description: 'Inclusive return posting date in the organization timezone.',
  })
  @IsOptional()
  @IsBusinessDate()
  from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsBusinessDate() to?: string;
  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional()
  @IsString()
  @Length(1, 256)
  cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
export class RefundQueryDto extends OmitType(ReturnQueryDto, ['status', 'from', 'to'] as const) {
  @ApiPropertyOptional({ format: 'date', description: 'Inclusive refund payment date.' })
  @IsOptional()
  @IsBusinessDate()
  from?: string;
  @ApiPropertyOptional({ format: 'date' }) @IsOptional() @IsBusinessDate() to?: string;
}
export class AllocationDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() salesReturnId!: string;
  @ApiProperty({ type: String, pattern: MONEY_PATTERN.source })
  @IsString()
  @Matches(MONEY_PATTERN)
  allocatedAmount!: string;
}
export class CreateRefundDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() salesOrderId!: string;
  @ApiProperty({ type: String, pattern: MONEY_PATTERN.source })
  @IsString()
  @Matches(MONEY_PATTERN)
  amount!: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) paymentMethod!: PaymentMethod;
  @ApiProperty({ type: String, format: 'date' }) @IsBusinessDate() paymentDate!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reference?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
  @ApiProperty({ type: [AllocationDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((i: AllocationDto) => i.salesReturnId)
  @ValidateNested({ each: true })
  @Type(() => AllocationDto)
  allocations!: AllocationDto[];
}
