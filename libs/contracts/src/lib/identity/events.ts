import { defineEvent } from '../events/envelope';
import type { ProfilePhotoUrls } from './photos';
import type { Locale } from './rpc';

/**
 * A new account exists (email + password or first Google sign-in).
 * Carries `email` because Notifications keeps it in its own read model.
 * `identity:republish-registered` may send it again for an existing account,
 * so consumers treat it as "this account's details", never as news.
 */
export interface UserRegisteredV1Payload {
  userId: string;
  email: string;
  displayName: string;
  locale: Locale;
}
export const UserRegisteredV1 = defineEvent<UserRegisteredV1Payload>()(
  'user.registered',
  1,
);

/**
 * The user changed their profile (`PATCH /me`). Only sent when something
 * actually changed, or re-announced unchanged by `identity:republish-users`.
 * Carries the current values, so the newest event wins (consumers compare
 * `occurredAt`). Catalog and Bookings keep names from it (Catalog also the bio).
 */
export interface UserProfileUpdatedV1Payload {
  userId: string;
  displayName: string;
  locale: Locale;
  /**
   * The public profile photo (ADR-0024): its addresses, or null for none.
   * Added later, so optional: absent (older events) means "unknown, keep
   * what you have". Sent with every change, including the photo's own.
   */
  photo?: ProfilePhotoUrls | null;
  /**
   * The public bio (ADR-0025), or null for none. Optional like `photo`:
   * absent means "unknown, keep what you have".
   */
  bio?: string | null;
}
export const UserProfileUpdatedV1 = defineEvent<UserProfileUpdatedV1Payload>()(
  'user.profile_updated',
  1,
);

/**
 * The user asked to delete their account (`DELETE /me`). Identity has already
 * anonymised its own data; every other service must anonymise or delete what
 * it holds for `userId`, keeping only what the law requires.
 */
export interface UserDeletionRequestedV1Payload {
  userId: string;
}
export const UserDeletionRequestedV1 =
  defineEvent<UserDeletionRequestedV1Payload>()('user.deletion_requested', 1);

/**
 * The account's email is proven to be the user's: an email link (verification
 * or password reset) or a verified Google sign-in. Sent once per account,
 * though `identity:republish-users` may announce it again: consumers keep the
 * first and never treat it as news. Catalog requires it to publish items,
 * Bookings to request bookings.
 */
export interface UserEmailVerifiedV1Payload {
  userId: string;
}
export const UserEmailVerifiedV1 = defineEvent<UserEmailVerifiedV1Payload>()(
  'user.email_verified',
  1,
);
