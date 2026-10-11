import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
export class AiCreateDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;
}
export class AiMessageDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() clientMessageId!: string;
  @ApiProperty({ maxLength: 2000 }) @IsString() @MinLength(1) @MaxLength(2000) content!: string;
}
export class AiSettingsDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ enum: ['v1'] }) @IsIn(['v1']) disclosureVersion!: 'v1';
}
export class AiPageDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsUUID()
  cursor?: string;
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
