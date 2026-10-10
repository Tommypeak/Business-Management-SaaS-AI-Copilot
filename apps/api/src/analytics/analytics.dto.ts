import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import type { AnalyticsGranularity } from '@saas/types';
import { IsBusinessDate } from '../expenses/expenses.dto.js';
const optional = () => ValidateIf((_object: unknown, value: unknown) => value !== undefined);
export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    description: 'Inclusive local business date. Both dates or neither; maximum 366 days.',
  })
  @optional()
  @IsBusinessDate()
  from?: string;
  @ApiPropertyOptional({ format: 'date' }) @optional() @IsBusinessDate() to?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @optional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID()
  locationId?: string;
  @ApiPropertyOptional({ enum: ['DAY', 'WEEK', 'MONTH'], default: 'DAY' })
  @IsIn(['DAY', 'WEEK', 'MONTH'])
  granularity: AnalyticsGranularity = 'DAY';
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;
  @ApiPropertyOptional({ enum: ['PRODUCT', 'SERVICE', 'UNKNOWN'] })
  @optional()
  @IsIn(['PRODUCT', 'SERVICE', 'UNKNOWN'])
  itemType?: string;
  @ApiPropertyOptional({ enum: ['SALE', 'RECEIPT', 'INVENTORY', 'EXPENSE', 'SUPPLIER_PAYMENT'] })
  @optional()
  @IsIn(['SALE', 'RECEIPT', 'INVENTORY', 'EXPENSE', 'SUPPLIER_PAYMENT'])
  kind?: string;
}
