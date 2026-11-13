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
  BIO_MAX_LENGTH,
  BIO_MAX_LINES,
  bioProblem,
  normaliseBio,
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  LOCALES,
  OAUTH_PROVIDERS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PROFILE_PHOTO_UPLOAD_STATUSES,
  type ProfilePhotoUploadStatus,
  isValidPassword,
  type Locale,
  type OAuthProvider,
} from '@borrowbox/contracts';

import { BookingsDataExportResponse } from './bookings/bookings.api';
import { CatalogDataExportResponse } from './items/items.api';
import {
  MessagingDataExportResponse,
  NotificationsDataExportResponse,
} from './messaging/messaging.api';
import { PaymentsDataExportResponse } from './payments/payments.api';
import { ProfilePhotoUrlsResponse } from './profile-photo.api';

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
        message: `$property must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters with at least one letter and one digit`,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isValidPassword(value),
      },
    });
}

/** A normalised bio that passes the shared rule (ADR-0025); empty removes it. */
function IsBio(): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isBio',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: `$property must be at most ${BIO_MAX_LENGTH} characters and ${BIO_MAX_LINES} lines, without phone numbers, emails or links`,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && bioProblem(value) === null,
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

  @ApiPropertyOptional({
    maxLength: BIO_MAX_LENGTH,
    description: `Public bio (ADR-0025): trimmed, at most ${BIO_MAX_LENGTH} characters and ${BIO_MAX_LINES} lines, no phone numbers, emails or links. An empty string removes it.`,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? normaliseBio(value) : value,
  )
  @IsString()
  @MaxLength(1000)
  @IsBio()
  bio?: string;
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

/** Email links carry a 43-character token; anything else is simply `TOKEN_INVALID`. */
const TOKEN_MAX_LENGTH = 128;

export class VerifyEmailBody {
  @ApiProperty({
    maxLength: TOKEN_MAX_LENGTH,
    description: 'The `t` value from the verification link’s fragment',
  })
  @IsString()
  @MaxLength(TOKEN_MAX_LENGTH)
  token!: string;
}

export class RequestPasswordResetBody {
  @ApiProperty({ format: 'email', maxLength: EMAIL_MAX_LENGTH })
  @trim()
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;
}

export class ResetPasswordBody {
  @ApiProperty({
    maxLength: TOKEN_MAX_LENGTH,
    description: 'The `t` value from the reset link’s fragment',
  })
  @IsString()
  @MaxLength(TOKEN_MAX_LENGTH)
  token!: string;

  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    format: 'password',
    description: 'At least one letter and one digit',
  })
  @IsAcceptablePassword()
  newPassword!: string;
}

export class ChangePasswordBody {
  @ApiProperty({ format: 'password', maxLength: 256 })
  @IsString()
  @MaxLength(256)
  currentPassword!: string;

  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    format: 'password',
    description: 'At least one letter and one digit',
  })
  @IsAcceptablePassword()
  newPassword!: string;
}

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
  @ApiProperty({
    type: ProfilePhotoUrlsResponse,
    nullable: true,
    description: 'Public profile photo (ADR-0024); null for none',
  })
  photo!: ProfilePhotoUrlsResponse | null;
  @ApiProperty({
    enum: PROFILE_PHOTO_UPLOAD_STATUSES,
    enumName: 'ProfilePhotoUploadStatus',
    nullable: true,
    description:
      'A new photo being processed (PENDING) or rejected (FAILED); null when none is waiting',
  })
  photoUpload!: ProfilePhotoUploadStatus | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Public bio (ADR-0025); null for none',
  })
  bio!: string | null;
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
  @ApiProperty({
    type: ProfilePhotoUrlsResponse,
    nullable: true,
    description: 'Public profile photo (ADR-0024); null for none',
  })
  photo!: ProfilePhotoUrlsResponse | null;
  @ApiProperty({ type: String, nullable: true }) bio!: string | null;
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

/** `GET /me/export`: one section per service that holds personal data. */
export class DataExportResponse {
  @ApiProperty({ type: IdentityDataExportResponse })
  identity!: IdentityDataExportResponse;

  @ApiProperty({ type: CatalogDataExportResponse })
  catalog!: CatalogDataExportResponse;

  @ApiProperty({ type: BookingsDataExportResponse })
  bookings!: BookingsDataExportResponse;

  @ApiProperty({ type: MessagingDataExportResponse })
  messaging!: MessagingDataExportResponse;

  @ApiProperty({ type: NotificationsDataExportResponse })
  notifications!: NotificationsDataExportResponse;

  @ApiProperty({ type: PaymentsDataExportResponse })
  payments!: PaymentsDataExportResponse;
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
