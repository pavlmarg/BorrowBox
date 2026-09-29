import { Transform } from 'class-transformer';
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
  isValidPassword,
  type Locale,
  type LoginRequest,
  type LogoutRequest,
  type RefreshRequest,
  type RegisterRequest,
} from '@borrowbox/contracts';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** 8–64 characters with at least one letter and one digit (shared rule in @borrowbox/contracts). */
function IsAcceptablePassword(): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isAcceptablePassword',
      target: target.constructor,
      propertyName: propertyName as string,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isValidPassword(value),
      },
    });
}

export class RegisterDto implements RegisterRequest {
  @trim()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @IsAcceptablePassword()
  password!: string;

  @trim()
  @IsString()
  @Length(1, DISPLAY_NAME_MAX_LENGTH)
  displayName!: string;

  @IsOptional()
  @IsIn(LOCALES)
  locale?: Locale;
}

/**
 * Login doesn't re-apply the registration rules (they may change); it only
 * bounds sizes. A wrong-shaped email simply matches no account.
 */
export class LoginDto implements LoginRequest {
  @trim()
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @MaxLength(256)
  password!: string;
}

export class RefreshDto implements RefreshRequest {
  @IsString()
  @MaxLength(128)
  refreshToken!: string;
}

export class LogoutDto implements LogoutRequest {
  @IsString()
  @MaxLength(128)
  refreshToken!: string;
}
