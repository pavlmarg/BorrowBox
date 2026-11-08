import { Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  createEnvelope,
  PaymentCapturedV1,
  PaymentFailedV1,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import type { PaymentIntentState } from '../stripe/stripe-api';
import type { PaymentBookingRow } from './bookings.repository';
import { planCancellation } from './money-movements';
import {
  findPaymentByBooking,
  updatePayment,
  type PaymentRow,
} from './payments.repository';

const logger = new Logger('Payments');

/** Stripe's PaymentIntent and our payment disagree on the amount: a bug, never retried away. */
export class AmountMismatchError extends Error {
  constructor(paymentId: string) {
    super(`PaymentIntent amount differs from payment ${paymentId}`);
    this.name = 'AmountMismatchError';
  }
}

/**
 * Brings a payment up to date with its PaymentIntent as Stripe has it now
 * (never a webhook's copy: events can be late or out of order), in the
 * caller's transaction with the payment row locked. Events go to the
 * outbox in the same transaction:
 * - succeeded: `payment.captured`; or, if the booking had already closed,
 *   a full refund is planned (ADR-0021) and logged as an error;
 * - a failed attempt (`payment_intent.payment_failed`): `payment.failed`,
 *   so the renter is told; they may try again until the pay-by time;
 * - processing / canceled: recorded.
 */
export async function applyIntentState(
  tx: EntityManager,
  payment: PaymentRow,
  booking: PaymentBookingRow | null,
  intent: PaymentIntentState,
  cause: { correlationId: string },
  stripeEventType: string | null,
): Promise<void> {
  if (intent.amountCents !== payment.amount_cents) {
    throw new AmountMismatchError(payment.id);
  }
  // Paid already: whatever came after (refunded, settled) is never undone
  // by a late or repeated webhook.
  const settled =
    payment.status === 'SUCCEEDED' ||
    payment.status === 'NEEDS_REFUND' ||
    payment.status === 'REFUNDED' ||
    payment.status === 'SETTLED';

  switch (intent.status) {
    case 'succeeded': {
      if (settled) return;
      if (!booking || booking.status === 'CLOSED') {
        logger.error(
          `Payment ${payment.id} succeeded after booking ${payment.booking_id} closed: refund due`,
        );
        await updatePayment(tx, payment.id, {
          status: 'NEEDS_REFUND',
          paid: true,
          lastAttemptFailed: false,
          cancelPending: false,
          chargeId: intent.latestChargeId,
        });
        if (booking) {
          await planCancellation(
            tx,
            (await findPaymentByBooking(tx, payment.booking_id)) as PaymentRow,
            booking,
            { by: 'LATE_PAYMENT' },
          );
        }
        return;
      }
      await updatePayment(tx, payment.id, {
        status: 'SUCCEEDED',
        paid: true,
        lastAttemptFailed: false,
        cancelPending: false,
        chargeId: intent.latestChargeId,
      });
      await addToOutbox(
        tx,
        createEnvelope(
          PaymentCapturedV1,
          { bookingId: payment.booking_id, amountCents: payment.amount_cents },
          cause,
        ),
      );
      return;
    }
    case 'processing':
      if (payment.status === 'REQUIRES_PAYMENT') {
        await updatePayment(tx, payment.id, { status: 'PROCESSING' });
      }
      return;
    case 'canceled':
      if (!settled) {
        await updatePayment(tx, payment.id, {
          status: 'CANCELLED',
          cancelPending: false,
        });
      }
      return;
    case 'requires_capture':
      // Never with automatic capture; nothing to do until it settles.
      return;
    default: {
      // Waiting for the renter: back from processing if the bank said no.
      if (payment.status === 'PROCESSING') {
        await updatePayment(tx, payment.id, { status: 'REQUIRES_PAYMENT' });
      }
      const failed =
        stripeEventType === 'payment_intent.payment_failed' &&
        intent.lastAttemptFailed;
      if (!failed || settled || payment.status === 'CANCELLED') return;
      await updatePayment(tx, payment.id, { lastAttemptFailed: true });
      if (booking?.status === 'AWAITING_PAYMENT' && booking.pay_by) {
        await addToOutbox(
          tx,
          createEnvelope(
            PaymentFailedV1,
            {
              bookingId: booking.booking_id,
              renterId: booking.renter_id,
              lenderId: booking.lender_id,
              itemTitle: booking.item_title,
              amountCents: payment.amount_cents,
              payBy: booking.pay_by.toISOString(),
            },
            cause,
          ),
        );
      }
    }
  }
}
