/**
 * Lender payouts (ADR-0019): what Payments shows about a lender's Stripe
 * connected account, and the timing the gateway derives its waits from.
 */

/**
 * Where a lender's payout setup stands:
 * - `NOT_STARTED`: never opened Stripe's onboarding.
 * - `INCOMPLETE`: started, but Stripe still needs details from them.
 * - `PENDING`: details sent; Stripe is checking them.
 * - `READY`: they can be paid.
 * - `RESTRICTED`: Stripe has disabled payouts to them, e.g. more information is due.
 */
export const PAYOUT_STATUSES = [
  'NOT_STARTED',
  'INCOMPLETE',
  'PENDING',
  'READY',
  'RESTRICTED',
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export interface PayoutAccountView {
  status: PayoutStatus;
  /** Whether Stripe pays out their balance to their bank account. */
  payoutsEnabled: boolean;
  /** When Payments last heard from Stripe about the account, or null. */
  updatedAt: string | null;
}

/** A single-use link to a Stripe-hosted page. */
export interface StripeLinkView {
  url: string;
  /** When the link stops working, or null if Stripe gives no expiry. */
  expiresAt: string | null;
}

/** Payments' timeout for each request it makes to Stripe. */
export const STRIPE_HTTP_TIMEOUT_MS = 10_000;

/** Attempts per Stripe request: the first try and one retry (idempotent). */
export const STRIPE_HTTP_ATTEMPTS = 2;

/** Extra time on top, for Payments' own work (database). */
const STRIPE_CALL_MARGIN_MS = 5_000;

/**
 * The longest the Stripe SDK sleeps before its retries of one request: 0.5 s
 * before the first, doubling, at most 5 s each (stripe-node's backoff).
 */
export function stripeRetrySleepMs(attempts = STRIPE_HTTP_ATTEMPTS): number {
  let total = 0;
  for (let retry = 1; retry < attempts; retry++) {
    total += Math.min(500 * 2 ** (retry - 1), 5_000);
  }
  return total;
}

/**
 * How long the gateway waits for a Payments call that makes up to
 * `requests` Stripe requests: longer than everything Payments may wait
 * (every attempt timing out, plus the SDK's sleeps between them), so a slow
 * Stripe never makes the gateway report a failure Payments completes.
 */
export function stripeCallTimeoutMs(requests: number): number {
  return (
    (STRIPE_HTTP_TIMEOUT_MS * STRIPE_HTTP_ATTEMPTS + stripeRetrySleepMs()) *
      requests +
    STRIPE_CALL_MARGIN_MS
  );
}
