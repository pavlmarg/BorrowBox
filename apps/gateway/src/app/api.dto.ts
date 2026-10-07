import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  registerDecorator,
} from 'class-validator';
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  LOCALES,
  OAUTH_PROVIDERS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isValidPassword,
  type Locale,
  type OAuthProvider,
} from '@borrowbox/contracts';

import { CatalogDataExportResponse } from './items/items.api';

// HTTP DTOs: validated here, validated again by Identity (never trust the
// edge alone), and the source of the OpenAPI spec the PWA client is generated from.

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

function IsAcceptablePassword(): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isAcceptablePassword',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: `password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters with at least one letter and one digit`,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isValidPassword(value),
      },
    });
}

// --- Requests ---------------------------------------------------------------

export class RegisterBody {
  @ApiProperty({ format: 'email', maxLength: EMAIL_MAX_LENGTH })
  @trim()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    format: 'password',
    description: 'At least one letter and one digit',
  })
  @IsAcceptablePassword()
  password!: string;

  @ApiProperty({ minLength: 1, maxLength: DISPLAY_NAME_MAX_LENGTH })
  @trim()
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  displayName!: string;

  @ApiPropertyOptional({ enum: LOCALES, enumName: 'Locale', default: 'el' })
  @IsOptional()
  @IsIn(LOCALES)
  locale?: Locale;
}

export class LoginBody {
  @ApiProperty({ format: 'email', maxLength: EMAIL_MAX_LENGTH })
  @trim()
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({ format: 'password', maxLength: 256 })
  @IsString()
  @MaxLength(256)
  password!: string;
}

export class UpdateProfileBody {
  @ApiPropertyOptional({ minLength: 1, maxLength: DISPLAY_NAME_MAX_LENGTH })
  @IsOptional()
  @trim()
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

  @ApiPropertyOptional({ enum: LOCALES, enumName: 'Locale' })
  @IsOptional()
  @IsIn(LOCALES)
  locale?: Locale;
}

export class DeleteAccountBody {
  @ApiPropertyOptional({
    format: 'password',
    maxLength: 256,
    description:
      'Required when the account has a password (`UserProfile.hasPassword`). Otherwise the session must be less than 5 minutes old.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;
}

// --- Responses --------------------------------------------------------------

export class UserProfileResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: LOCALES, enumName: 'Locale' }) locale!: Locale;
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty() hasPassword!: boolean;
  @ApiProperty({
    enum: OAUTH_PROVIDERS,
    enumName: 'OAuthProvider',
    isArray: true,
  })
  providers!: OAuthProvider[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

/** The refresh token is never in a body: it is set as the httpOnly `bb_refresh` cookie. */
export class AuthResponse {
  @ApiProperty({ description: 'Bearer token for `Authorization` (15 min)' })
  accessToken!: string;

  @ApiProperty({ format: 'date-time' })
  accessTokenExpiresAt!: string;

  @ApiProperty({ type: UserProfileResponse })
  @Type(() => UserProfileResponse)
  user!: UserProfileResponse;
}

export class ExportedUser {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: LOCALES, enumName: 'Locale' }) locale!: Locale;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  emailVerifiedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ExportedOAuthIdentity {
  @ApiProperty({ enum: OAUTH_PROVIDERS, enumName: 'OAuthProvider' })
  provider!: OAuthProvider;
  @ApiProperty({ format: 'date-time' }) linkedAt!: string;
}

export class ExportedSession {
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class IdentityDataExportResponse {
  @ApiProperty({ format: 'date-time' }) exportedAt!: string;
  @ApiProperty({ type: ExportedUser }) user!: ExportedUser;
  @ApiProperty({ type: ExportedOAuthIdentity, isArray: true })
  oauthIdentities!: ExportedOAuthIdentity[];
  @ApiProperty({ type: ExportedSession, isArray: true })
  sessions!: ExportedSession[];
}

/** `GET /me/export`. Phase 7 adds the other services' sections. */
export class DataExportResponse {
  @ApiProperty({ type: IdentityDataExportResponse })
  identity!: IdentityDataExportResponse;

  @ApiProperty({ type: CatalogDataExportResponse })
  catalog!: CatalogDataExportResponse;
}

export class ApiErrorResponse {
  @ApiProperty() statusCode!: number;
  @ApiProperty({
    description:
      'Stable machine-readable code, e.g. VALIDATION_FAILED, INVALID_CREDENTIALS, EMAIL_TAKEN, RATE_LIMITED',
  })
  code!: string;
  @ApiProperty() message!: string;
}

export class HealthResponse {
  @ApiProperty({ enum: ['ok'] }) status!: 'ok';
}
