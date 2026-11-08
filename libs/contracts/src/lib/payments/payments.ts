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

/**
 * A renter's payment for a booking (ADR-0019), as the renter sees it:
 * - `REQUIRES_PAYMENT`: waiting for the renter (also after a failed attempt);
 * - `PROCESSING`: the bank is still confirming;
 * - `SUCCEEDED`: paid;
 * - `CANCELLED`: the booking closed before it was paid;
 * - `NEEDS_REFUND`: paid, but the booking had closed meanwhile: refunded in full.
 */
export const PAYMENT_STATUSES = [
  'REQUIRES_PAYMENT',
  'PROCESSING',
  'SUCCEEDED',
  'CANCELLED',
  'NEEDS_REFUND',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Paying can't start (or resume) this close to the pay-by time, so it can't run past it. */
export const CHECKOUT_CUTOFF_MINUTES = 10;

export interface PaymentView {
  bookingId: string;
  status: PaymentStatus;
  rentCents: number;
  depositCents: number;
  feeCents: number;
  /** What the renter pays: rent + deposit + fee. */
  chargeCents: number;
  /** When the booking expires unless paid. */
  payBy: string;
  /** The last attempt failed (declined card, failed 3-D Secure); the renter may try again. */
  lastAttemptFailed: boolean;
  paidAt: string | null;
}

/**
 * What the PWA needs to take the payment with Stripe's own form (the web
 * pass). The client secret lets its holder pay this booking only: it goes to
 * the renter and nowhere else, and is never logged or stored.
 */
export interface CheckoutView extends PaymentView {
  clientSecret: string;
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
