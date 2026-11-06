import { defineEvent } from '../events/envelope';
import type { Locale } from './rpc';

/**
 * A new account exists (email + password or first Google sign-in).
 * Carries `email` because Notifications keeps it in its own read model.
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
 * `occurredAt`). Catalog and Bookings keep names from it.
 */
export interface UserProfileUpdatedV1Payload {
  userId: string;
  displayName: string;
  locale: Locale;
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
