import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { DISPLAY_NAME_MAX_LENGTH } from '@borrowbox/contracts';

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
