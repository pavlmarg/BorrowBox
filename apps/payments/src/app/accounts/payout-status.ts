import type { PayoutStatus } from '@borrowbox/contracts';
import type { AccountFlags } from '../stripe/stripe-api';

/** What the lender sees, from the flags last fetched from Stripe. */
export function payoutStatus(flags: AccountFlags | null): PayoutStatus {
  if (!flags) return 'NOT_STARTED';
  // Ready means Payments can transfer to them (A4).
  if (flags.transfersActive) return 'READY';
  if (flags.disabled) return 'RESTRICTED';
  if (!flags.detailsSubmitted) return 'INCOMPLETE';
  return 'PENDING';
}

/**
 * Which event, if any, a change of readiness announces: becoming ready is
 * `payment.account_ready`, losing it `payment.account_restricted`.
 */
export function readinessChange(
  wasReady: boolean,
  isReady: boolean,
): 'READY' | 'RESTRICTED' | null {
  if (!wasReady && isReady) return 'READY';
  if (wasReady && !isReady) return 'RESTRICTED';
  return null;
}
