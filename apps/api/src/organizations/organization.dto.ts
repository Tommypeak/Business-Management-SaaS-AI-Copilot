import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsString,
  IsTimeZone,
  Length,
  Matches,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { BUSINESS_TYPES, type BusinessType } from '@saas/types';

export const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;
const IsLocaleTag = () =>
  ValidateBy({
    name: 'isLocaleTag',
    validator: {
      validate(value: unknown): boolean {
        if (typeof value !== 'string' || value.length > 35) return false;
        try {
          return Intl.getCanonicalLocales(value).length === 1;
        } catch {
          return false;
        }
      },
      defaultMessage: () => 'locale must be a valid BCP 47 language tag',
    },
  });

export class CreateOrganizationDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ enum: BUSINESS_TYPES })
  @IsIn(BUSINESS_TYPES)
  businessType!: BusinessType;

  @ApiProperty({ example: 'USD', description: 'ISO 4217 currency code' })
  @IsIn(Intl.supportedValuesOf('currency'))
  defaultCurrency!: string;

  @ApiProperty({ example: 'Asia/Almaty' })
  @IsString()
  @Length(1, 100)
  @IsTimeZone()
  @Matches(/^[A-Za-z]/, { message: 'timezone must be an IANA name, not a UTC offset' })
  timezone!: string;

  @ApiProperty({ default: 'en', required: false })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsLocaleTag()
  locale?: string;
}

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto, {
  skipNullProperties: false,
}) {}
