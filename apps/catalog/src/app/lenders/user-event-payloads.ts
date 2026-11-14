import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  BIO_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  type ProfilePhotoUrls,
} from '@borrowbox/contracts';

const HTTP_URL = /^https?:\/\/\S+$/;

/** A profile photo's addresses (ADR-0024), as Identity publishes them. */
export class ProfilePhotoPayload implements ProfilePhotoUrls {
  @Matches(HTTP_URL)
  @MaxLength(2048)
  small!: string;

  @Matches(HTTP_URL)
  @MaxLength(2048)
  large!: string;
}

/**
 * Identity's events as Catalog reads them, checked at runtime with
 * `parsePayload` (`@borrowbox/service-kit`).
 */

/** `user.registered.v1` and `user.profile_updated.v1`: only these fields are kept. */
export class UserNamePayload {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName!: string;

  /**
   * `user.profile_updated` only: null for none; absent (`user.registered`,
   * older events) means "unknown, keep what we have".
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ProfilePhotoPayload)
  photo?: ProfilePhotoPayload | null;

  /** Like `photo` (ADR-0025): null for none, absent keeps what we have. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(BIO_MAX_LENGTH * 2) // a loose bound: Identity enforces the rule
  bio?: string | null;
}

/** `user.email_verified.v1`. */
export class UserVerifiedPayload {
  @IsUUID()
  userId!: string;
}

/** `user.deletion_requested.v1`. */
export class UserDeletionPayload {
  @IsUUID()
  userId!: string;
}
