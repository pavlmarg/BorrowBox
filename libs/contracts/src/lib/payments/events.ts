import { defineEvent } from '../events/envelope';

/**
 * Payments events (ADR-0003, ADR-0019). People are known by id only: no
 * names, emails, bank details or Stripe objects.
 */

/**
 * The lender can be paid: Stripe has activated the transfers capability of
 * their connected account. Sent each time it becomes true, so it may follow
 * an earlier `payment.account_restricted`.
 */
export interface PaymentAccountReadyV1Payload {
  userId: string;
}
export const PaymentAccountReadyV1 =
  defineEvent<PaymentAccountReadyV1Payload>()('payment.account_ready', 1);

/**
 * The lender can no longer be paid: Stripe deactivated transfers on an
 * account that was ready (e.g. more information is due). Sent only after a
 * `payment.account_ready`.
 */
export interface PaymentAccountRestrictedV1Payload {
  userId: string;
}
export const PaymentAccountRestrictedV1 =
  defineEvent<PaymentAccountRestrictedV1Payload>()(
    'payment.account_restricted',
    1,
  );
