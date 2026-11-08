import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import {
  CHECKOUT_CUTOFF_MINUTES,
  type CheckoutView,
  type PaymentStatus,
  type PaymentView,
} from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { PaymentsError, unauthenticated, viaStripe } from '../payments.error';
import {
  STRIPE_API,
  type PaymentIntentState,
  type StripeApi,
} from '../stripe/stripe-api';
import { findUser } from '../users/verified-users.repository';
import {
  findBooking,
  lockBooking,
  type PaymentBookingRow,
} from './bookings.repository';
import {
  ensurePayment,
  findPaymentByBooking,
  setPaymentIntent,
  updatePayment,
  type PaymentRow,
} from './payments.repository';

/**
 * The renter pays an accepted booking (ADR-0019): one PaymentIntent per
 * booking for rent + deposit + fee, created when they first start paying
 * and fetched again when they come back. The PWA takes the card with
 * Stripe's own form; the payment's outcome arrives by webhook.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(STRIPE_API) private readonly stripe: StripeApi,
  ) {}

  async start(userId: string, bookingId: string): Promise<CheckoutView> {
    const { payment, booking } = await this.dataSource.transaction(
      async (tx) => {
        await assertLive(tx, userId);
        const booking = await lockBooking(tx, bookingId);
        if (!booking || booking.renter_id !== userId) throw notFound();
        if (booking.status !== 'AWAITING_PAYMENT') {
          throw invalidState(
            booking.status === 'PAID'
              ? 'This booking is already paid'
              : 'This booking is no longer waiting for payment',
          );
        }
        assertWindowOpen(booking);
        const payment = await ensurePayment(tx, randomUUID(), booking);
        if (payment.status !== 'REQUIRES_PAYMENT') {
          throw invalidState(
            payment.status === 'PROCESSING'
              ? 'This payment is being processed'
              : 'This booking is no longer waiting for payment',
          );
        }
        return { payment, booking };
      },
    );

    // Outside the transaction: no lock is held while Stripe answers.
    let intent: PaymentIntentState;
    if (payment.stripe_payment_intent_id) {
      const id = payment.stripe_payment_intent_id;
      intent = await viaStripe(() => this.stripe.retrievePaymentIntent(id));
    } else {
      intent = await viaStripe(() =>
        this.stripe.createPaymentIntent({
          bookingId,
          amountCents: payment.amount_cents,
          // Our row's id: a retry, or a second tab, gets the same PaymentIntent.
          idempotencyKey: `payment-${payment.id}`,
        }),
      );
      await setPaymentIntent(this.dataSource.manager, payment.id, intent.id);
    }

    // A close that came in while Stripe answered wins: the PaymentIntent is
    // cancelled at Stripe and nothing goes to the renter.
    const tx = this.dataSource.manager;
    if ((await findBooking(tx, bookingId))?.status === 'CLOSED') {
      await updatePayment(tx, payment.id, {
        status: 'CANCELLED',
        cancelPending: true,
      });
      throw invalidState('This booking is no longer waiting for payment');
    }
    const current = (await findPaymentByBooking(tx, bookingId)) as PaymentRow;
    return { ...toView(booking, current), clientSecret: intent.clientSecret };
  }

  /** The payment as the renter sees it; never calls Stripe. */
  async get(userId: string, bookingId: string): Promise<PaymentView> {
    const tx = this.dataSource.manager;
    await assertLive(tx, userId);
    const booking = await findBooking(tx, bookingId);
    if (!booking || booking.renter_id !== userId) throw notFound();
    return toView(booking, await findPaymentByBooking(tx, bookingId));
  }
}

export function toView(
  booking: PaymentBookingRow,
  payment: PaymentRow | null,
): PaymentView {
  const amounts = payment ?? booking;
  return {
    bookingId: booking.booking_id,
    status: payment?.status ?? statusWithoutPayment(booking),
    rentCents: amounts.rent_cents,
    depositCents: amounts.deposit_cents,
    feeCents: amounts.fee_cents,
    chargeCents: amounts.rent_cents + amounts.deposit_cents + amounts.fee_cents,
    payBy:
      booking.status === 'AWAITING_PAYMENT' && booking.pay_by
        ? booking.pay_by.toISOString()
        : null,
    lastAttemptFailed: payment?.last_attempt_failed ?? false,
    paidAt: payment?.paid_at?.toISOString() ?? null,
  };
}

/** Paying never started: what the booking's state means for the renter. */
function statusWithoutPayment(booking: PaymentBookingRow): PaymentStatus {
  switch (booking.status) {
    case 'AWAITING_PAYMENT':
      return 'REQUIRES_PAYMENT';
    case 'PAID':
      return 'SUCCEEDED';
    case 'CLOSED':
      return 'CANCELLED';
  }
}

function assertWindowOpen(booking: PaymentBookingRow): void {
  const left = (booking.pay_by?.getTime() ?? 0) - Date.now();
  if (left < CHECKOUT_CUTOFF_MINUTES * 60 * 1000) {
    throw new PaymentsError(
      'PAYMENT_WINDOW_CLOSED',
      'It is too late to pay for this booking',
    );
  }
}

/** An erased account's still-valid token can't use Payments. */
async function assertLive(tx: EntityManager, userId: string): Promise<void> {
  if ((await findUser(tx, userId))?.deleted_at) throw unauthenticated();
}

function notFound(): PaymentsError {
  return new PaymentsError('NOT_FOUND', 'Booking not found');
}

function invalidState(message: string): PaymentsError {
  return new PaymentsError('INVALID_STATE', message);
}
