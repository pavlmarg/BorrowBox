import type { PaymentsErrorCode } from '@borrowbox/contracts';
import { ServiceError } from '@borrowbox/service-kit';
import { StripeUnavailableError } from './stripe/stripe-api';

/** Payments' client-facing errors. Messages reach the browser: no personal data. */
export class PaymentsError extends ServiceError<PaymentsErrorCode> {}

export function unauthenticated(): PaymentsError {
  return new PaymentsError('UNAUTHENTICATED', 'Authentication required');
}

/** Runs a Stripe call; Stripe being unreachable becomes `PROVIDER_UNAVAILABLE`. */
export async function viaStripe<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StripeUnavailableError) {
      throw new PaymentsError(
        'PROVIDER_UNAVAILABLE',
        'The payment provider is unavailable, try again later',
      );
    }
    throw err;
  }
}
