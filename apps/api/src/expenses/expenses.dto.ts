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
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  EXPENSE_STATUSES,
  PAYMENT_METHODS,
  type ExpenseStatus,
  type PaymentMethod,
} from '@saas/types';
import { MONEY_PATTERN } from '../catalog/catalog.dto.js';
import { trim } from '../organizations/organization.dto.js';

const optional = () => ValidateIf((_object: unknown, value: unknown) => value !== undefined);
const lower = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;
const displayName = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value;

export function validBusinessDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const IsBusinessDate = () =>
  ValidateBy({
    name: 'isBusinessDate',
    validator: {
      validate: validBusinessDate,
      defaultMessage: () => 'Must be a real calendar date in YYYY-MM-DD format',
    },
  });

export class CategoryDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(displayName)
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}
export class UpdateCategoryDto extends PartialType(CategoryDto, { skipNullProperties: false }) {
  @ApiPropertyOptional() @optional() @IsIn([true, false]) isActive?: boolean;
}
export class CategoryQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @optional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @optional()
  @IsIn(['true', 'false'])
  isActive?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
  @ApiPropertyOptional({ maxLength: 256 })
  @optional()
  @IsString()
  @Length(1, 256)
  cursor?: string;
}

export class CreateExpenseDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() categoryId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @Transform(lower)
  @IsUUID()
  locationId?: string | null;
  @ApiProperty({ type: String, format: 'date', example: '2026-10-09' })
  @IsBusinessDate()
  expenseDate!: string;
  @ApiProperty({ type: String, pattern: MONEY_PATTERN.source })
  @IsString()
  @Matches(MONEY_PATTERN)
  amount!: string;
  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: PaymentMethod;
  @ApiPropertyOptional({ nullable: true, maxLength: 200 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  payeeName?: string | null;
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
export class UpdateExpenseDto extends PartialType(CreateExpenseDto, {
  skipNullProperties: false,
}) {}

export class VoidExpenseDto {
  @ApiProperty({ maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @Length(1, 1000)
  reason!: string;
}

export class ExpenseQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @optional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional({ enum: EXPENSE_STATUSES })
  @optional()
  @IsIn(EXPENSE_STATUSES)
  status?: ExpenseStatus;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(lower)
  @IsUUID()
  categoryId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(lower)
  @IsUUID()
  locationId?: string;
  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @optional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: PaymentMethod;
  @ApiPropertyOptional({ type: String, format: 'date' })
  @optional()
  @IsBusinessDate()
  from?: string;
  @ApiPropertyOptional({ type: String, format: 'date' })
  @optional()
  @IsBusinessDate()
  to?: string;
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

export class FinanceQueryDto {
  @ApiPropertyOptional({ type: String, format: 'date' })
  @optional()
  @IsBusinessDate()
  from?: string;
  @ApiPropertyOptional({ type: String, format: 'date' })
  @optional()
  @IsBusinessDate()
  to?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(lower)
  @IsUUID()
  locationId?: string;
}
