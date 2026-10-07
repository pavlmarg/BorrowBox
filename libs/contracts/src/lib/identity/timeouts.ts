/**
 * Timing shared by Identity and the gateway for Google sign-in, so the
 * gateway's wait is always derived from what Identity actually allows.
 */

/** Identity's timeout for each HTTP request it makes to Google. */
export const GOOGLE_HTTP_TIMEOUT_MS = 10_000;

/** The most requests one sign-in makes: discovery (first time), token exchange, signing keys. */
export const GOOGLE_EXCHANGE_MAX_REQUESTS = 3;

/** Extra time on top, for Identity's own work (database, token signing). */
const GOOGLE_EXCHANGE_MARGIN_MS = 5_000;

/**
 * How long the gateway waits for `identity.google.exchange`: longer than
 * every Google request Identity may make, so a slow Google never makes the
 * gateway report a failure for a sign-in Identity completes.
 */
export const GOOGLE_EXCHANGE_TIMEOUT_MS =
  GOOGLE_HTTP_TIMEOUT_MS * GOOGLE_EXCHANGE_MAX_REQUESTS +
  GOOGLE_EXCHANGE_MARGIN_MS;
