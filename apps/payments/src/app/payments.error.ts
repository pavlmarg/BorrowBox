import { Logger } from '@nestjs/common';
import type { PaymentsErrorCode } from '@borrowbox/contracts';
import { ServiceError } from '@borrowbox/service-kit';
import { StripeCallError, StripeUnavailableError } from './stripe/stripe-api';

/** Payments' client-facing errors. Messages reach the browser: no personal data. */
export class PaymentsError extends ServiceError<PaymentsErrorCode> {}

export function unauthenticated(): PaymentsError {
  return new PaymentsError('UNAUTHENTICATED', 'Authentication required');
}

const logger = new Logger('Stripe');

/**
 * Runs a Stripe call for a user's request. Stripe being unreachable becomes
 * `PROVIDER_UNAVAILABLE` (try again); Stripe refusing the call (a bug or a
 * configuration problem) becomes `INTERNAL`. Both are logged with what
 * identifies the failure (class, code, status, request id), never Stripe's
 * message.
 */
export async function viaStripe<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StripeUnavailableError) {
      logger.warn(`Stripe unavailable: ${err.message}`);
      throw new PaymentsError(
        'PROVIDER_UNAVAILABLE',
        'The payment provider is unavailable, try again later',
      );
    }
    if (err instanceof StripeCallError) {
      logger.error(`Stripe refused a call (${err.name}): ${err.message}`);
      throw new PaymentsError('INTERNAL', 'Internal error');
    }
    throw err;
  }
}
