import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ADJUSTMENT_DIRECTIONS,
  ADJUSTMENT_REASONS,
  INVENTORY_TYPES,
  type AdjustmentDirection,
  type AdjustmentReason,
  type InventoryTransactionType,
} from '@saas/types';
import { trim } from '../organizations/organization.dto.js';

const optional = () => ValidateIf((_object: unknown, value: unknown) => value !== undefined);
const lower = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;
export const QUANTITY_PATTERN = /^(0|[1-9]\d{0,12})(\.\d{1,6})?$/;
export class NoteDto {
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
export class OpeningBalanceDto extends NoteDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() locationId!: string;
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() variantId!: string;
  @ApiProperty({
    type: String,
    pattern: QUANTITY_PATTERN.source,
    example: '10.123456',
    description: 'Strictly positive decimal string, numeric(19,6)',
  })
  @IsString()
  @Matches(QUANTITY_PATTERN)
  quantity!: string;
}
export class AdjustmentDto extends OpeningBalanceDto {
  @ApiProperty({ enum: ADJUSTMENT_DIRECTIONS })
  @IsIn(ADJUSTMENT_DIRECTIONS)
  direction!: AdjustmentDirection;
  @ApiProperty({ enum: ADJUSTMENT_REASONS }) @IsIn(ADJUSTMENT_REASONS) reason!: AdjustmentReason;
}
export class TransferDto extends NoteDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() sourceLocationId!: string;
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() destinationLocationId!: string;
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() variantId!: string;
  @ApiProperty({ type: String, pattern: QUANTITY_PATTERN.source, example: '1.250000' })
  @IsString()
  @Matches(QUANTITY_PATTERN)
  quantity!: string;
}
export class InventorySettingsDto {
  @ApiProperty() @IsBoolean() allowNegativeStock!: boolean;
}
export class StockQueryDto {
  @ApiPropertyOptional({ maximum: 100, default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
  @ApiPropertyOptional({ format: 'uuid' }) @optional() @Transform(lower) @IsUUID() cursor?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @optional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(lower)
  @IsUUID()
  locationId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(lower)
  @IsUUID()
  categoryId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @optional() @Transform(lower) @IsUUID() itemId?: string;
}
export class HistoryQueryDto {
  @ApiPropertyOptional({ maximum: 100, default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
  @ApiPropertyOptional({ maxLength: 256 }) @optional() @IsString() @Length(1, 256) cursor?: string;
  @ApiPropertyOptional({ enum: INVENTORY_TYPES })
  @optional()
  @IsIn(INVENTORY_TYPES)
  type?: InventoryTransactionType;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(lower)
  @IsUUID()
  locationId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(lower)
  @IsUUID()
  variantId?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @optional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @MaxLength(35)
  from?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @optional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @MaxLength(35)
  to?: string;
}
