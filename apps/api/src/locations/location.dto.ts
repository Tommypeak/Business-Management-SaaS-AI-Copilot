import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsString, Length, ValidateIf } from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { LOCATION_TYPES, type LocationType } from '@saas/types';
import { trim } from '../organizations/organization.dto.js';

export class CreateLocationDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ enum: LOCATION_TYPES })
  @IsIn(LOCATION_TYPES)
  type!: LocationType;

  @ApiProperty({ default: true, required: false })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
export class UpdateLocationDto extends PartialType(CreateLocationDto, {
  skipNullProperties: false,
}) {}
