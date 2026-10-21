import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';
import {
  EMAIL_MAX_LENGTH,
  type ChangePasswordRequest,
  type RequestPasswordResetRequest,
  type ResetPasswordRequest,
  type VerifyEmailRequest,
} from '@borrowbox/contracts';
import { IsAcceptablePassword } from '../auth/auth.dto';

/** A malformed token is simply invalid (`TOKEN_INVALID`), so only the size is bounded here. */
const TOKEN_MAX_LENGTH = 128;

export class VerifyEmailDto implements VerifyEmailRequest {
  @IsString()
  @MaxLength(TOKEN_MAX_LENGTH)
  token!: string;
}

/** Like login, the shape isn't checked: a wrong-shaped email matches no account. */
export class RequestPasswordResetDto implements RequestPasswordResetRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;
}

export class ResetPasswordDto implements ResetPasswordRequest {
  @IsString()
  @MaxLength(TOKEN_MAX_LENGTH)
  token!: string;

  @IsAcceptablePassword()
  newPassword!: string;
}

export class ChangePasswordDto implements ChangePasswordRequest {
  @IsString()
  @MaxLength(256)
  currentPassword!: string;

  @IsAcceptablePassword()
  newPassword!: string;
}
