import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import {
  DISPLAY_NAME_MAX_LENGTH,
  LOCALES,
  type DeleteAccountRequest,
  type Locale,
  type UpdateProfileRequest,
} from '@borrowbox/contracts';

export class UpdateProfileDto implements UpdateProfileRequest {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

  @IsOptional()
  @IsIn(LOCALES)
  locale?: Locale;
}

export class DeleteAccountDto implements DeleteAccountRequest {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;
}
