import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
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
  ValidateIf,
} from 'class-validator';
import {
  PAYMENT_METHODS,
  SUPPLIER_BILL_PAYMENT_STATUSES,
  SUPPLIER_BILL_STATUSES,
  type PaymentMethod,
  type SupplierBillPaymentStatus,
  type SupplierBillStatus,
} from '@saas/types';
import { MONEY_PATTERN } from '../catalog/catalog.dto.js';
import { trim } from '../organizations/organization.dto.js';
import { IsBusinessDate } from '../expenses/expenses.dto.js';

const optional = () => ValidateIf((_object: unknown, value: unknown) => value !== undefined);
const lower = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class CreateSupplierBillDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() supplierId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @Transform(lower)
  @IsUUID()
  purchaseOrderId?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 120 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierInvoiceNumber?: string | null;
  @ApiProperty({ type: String, format: 'date' }) @IsBusinessDate() issueDate!: string;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  @IsOptional()
  @IsBusinessDate()
  dueDate?: string | null;
  @ApiProperty({ type: String, pattern: MONEY_PATTERN.source })
  @IsString()
  @Matches(MONEY_PATTERN)
  amount!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
export class UpdateSupplierBillDto extends PartialType(CreateSupplierBillDto, {
  skipNullProperties: false,
}) {}
export class VoidSupplierBillDto {
  @ApiProperty({ maxLength: 1000 }) @Transform(trim) @IsString() @Length(1, 1000) reason!: string;
}
export class CreateSupplierPaymentDto {
  @ApiProperty({ type: String, pattern: MONEY_PATTERN.source })
  @IsString()
  @Matches(MONEY_PATTERN)
  amount!: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) method!: PaymentMethod;
  @ApiProperty({ type: String, format: 'date' }) @IsBusinessDate() paymentDate!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string | null;
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
export class SupplierBillQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @optional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional({ enum: SUPPLIER_BILL_STATUSES })
  @optional()
  @IsIn(SUPPLIER_BILL_STATUSES)
  status?: SupplierBillStatus;
  @ApiPropertyOptional({ enum: SUPPLIER_BILL_PAYMENT_STATUSES })
  @optional()
  @IsIn(SUPPLIER_BILL_PAYMENT_STATUSES)
  paymentStatus?: SupplierBillPaymentStatus;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(lower)
  @IsUUID()
  supplierId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(lower)
  @IsUUID()
  purchaseOrderId?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @optional()
  @IsIn(['true', 'false'])
  overdue?: string;
  @ApiPropertyOptional({ type: String, format: 'date' })
  @optional()
  @IsBusinessDate()
  issueDateFrom?: string;
  @ApiPropertyOptional({ type: String, format: 'date' })
  @optional()
  @IsBusinessDate()
  issueDateTo?: string;
  @ApiPropertyOptional({ type: String, format: 'date' })
  @optional()
  @IsBusinessDate()
  dueDateFrom?: string;
  @ApiPropertyOptional({ type: String, format: 'date' })
  @optional()
  @IsBusinessDate()
  dueDateTo?: string;
  @ApiPropertyOptional({ maxLength: 256 })
  @optional()
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
export class SupplierPaymentQueryDto {
  @ApiPropertyOptional({ maxLength: 256 }) @optional() @IsString() @Length(1, 256) cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
