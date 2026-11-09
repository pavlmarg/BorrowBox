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

/**
 * The renter's payment for a booking succeeded (ADR-0019): rent, deposit
 * and fee are on the platform account. Bookings moves the booking to PAID
 * if it's still waiting for payment.
 */
export interface PaymentCapturedV1Payload {
  bookingId: string;
  /** What was charged: rent + deposit + fee. */
  amountCents: number;
}
export const PaymentCapturedV1 = defineEvent<PaymentCapturedV1Payload>()(
  'payment.captured',
  1,
);

/**
 * An attempt to pay a booking failed (declined card, failed 3-D Secure).
 * The booking stays waiting for payment; the renter can try again until
 * `payBy` (ADR-0019). Carries what the renter's email needs.
 */
export interface PaymentFailedV1Payload {
  bookingId: string;
  renterId: string;
  lenderId: string;
  itemTitle: string;
  amountCents: number;
  payBy: string;
}
export const PaymentFailedV1 = defineEvent<PaymentFailedV1Payload>()(
  'payment.failed',
  1,
);

/**
 * Money went back to the renter's card for a cancelled booking, or for a
 * payment that arrived after the booking closed (ADR-0021). Stripe has
 * accepted the refund; banks take a few days to show it.
 */
export interface PaymentRefundedV1Payload {
  bookingId: string;
  renterId: string;
  lenderId: string;
  itemTitle: string;
  amountCents: number;
}
export const PaymentRefundedV1 = defineEvent<PaymentRefundedV1Payload>()(
  'payment.refunded',
  1,
);

/**
 * A completed booking is settled (ADR-0021): the lender was paid
 * (`payoutCents`, possibly 0) and the deposit went back to the renter
 * (`depositRefundCents`, possibly 0).
 */
export interface PaymentSettledV1Payload {
  bookingId: string;
  renterId: string;
  lenderId: string;
  itemTitle: string;
  payoutCents: number;
  depositRefundCents: number;
}
export const PaymentSettledV1 = defineEvent<PaymentSettledV1Payload>()(
  'payment.settled',
  1,
);
