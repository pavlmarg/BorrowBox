import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateBy,
} from 'class-validator';
import {
  bioProblem,
  DISPLAY_NAME_MAX_LENGTH,
  LOCALES,
  normaliseBio,
  type DeleteAccountRequest,
  type Locale,
  type PublicProfileRequest,
  type UpdateProfileRequest,
} from '@borrowbox/contracts';

/** A normalised bio that passes the shared rule (ADR-0025); empty is allowed (removes it). */
function IsBio(): PropertyDecorator {
  return ValidateBy({
    name: 'isBio',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && bioProblem(value) === null,
    },
  });
}

export class UpdateProfileDto implements UpdateProfileRequest {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

  @IsOptional()
  @IsIn(LOCALES)
  locale?: Locale;

  /** Normalised first; long input is refused before the rule runs. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? normaliseBio(value) : value,
  )
  @IsString()
  @MaxLength(1000)
  @IsBio()
  bio?: string;
}

export class PublicProfileDto implements PublicProfileRequest {
  @IsUUID()
  userId!: string;
}

export class DeleteAccountDto implements DeleteAccountRequest {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;
}
