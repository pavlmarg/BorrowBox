import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  cancellationPlan,
  createEnvelope,
  PaymentRefundedV1,
  PaymentSettledV1,
  settlementPlan,
  type CancellationCause,
  type MoneyMovementStatus,
  type PaidAmounts,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import type { PaymentBookingRow } from './bookings.repository';
import { updatePayment, type PaymentRow } from './payments.repository';

const logger = new Logger('Payments');

export type MovementKind = 'REFUND' | 'TRANSFER';
export type MovementPurpose =
  'CANCELLATION' | 'LATE_PAYMENT' | 'DEPOSIT' | 'RENT';

/** One refund or transfer (ADR-0021). Amounts in integer cents. */
export interface MoneyMovementRow {
  id: string;
  payment_id: string;
  booking_id: string;
  kind: MovementKind;
  purpose: MovementPurpose;
  amount_cents: number;
  recipient_id: string;
  status: MoneyMovementStatus;
  stripe_object_id: string | null;
  attempts: number;
  created_at: Date;
}

function amountsOf(payment: PaymentRow): PaidAmounts {
  return {
    rentCents: payment.rent_cents,
    depositCents: payment.deposit_cents,
    feeCents: payment.fee_cents,
    lenderFeeCents: payment.lender_fee_cents,
  };
}

/**
 * Plans one movement, once per payment and purpose, and adds it to the
 * payment's planned refunds or transfers in the same statement batch: the
 * database refuses (CHECK) anything beyond what was charged.
 */
async function planMovement(
  tx: EntityManager,
  payment: PaymentRow,
  m: {
    kind: MovementKind;
    purpose: MovementPurpose;
    amountCents: number;
    recipientId: string;
  },
): Promise<void> {
  if (m.amountCents <= 0) return;
  const inserted: unknown[] = await tx.query(
    `INSERT INTO money_movements (id, payment_id, booking_id, kind, purpose,
                                  amount_cents, recipient_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ON CONSTRAINT money_movements_once DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      payment.id,
      payment.booking_id,
      m.kind,
      m.purpose,
      m.amountCents,
      m.recipientId,
    ],
  );
  if (inserted.length === 0) return;
  await tx.query(
    m.kind === 'REFUND'
      ? `UPDATE payments SET refunded_cents = refunded_cents + $2 WHERE id = $1`
      : `UPDATE payments SET transferred_cents = transferred_cents + $2 WHERE id = $1`,
    [payment.id, m.amountCents],
  );
}

/**
 * Why a paid booking closed, as far as the money goes (ADR-0021). A booking
 * that never went ahead (no `booking.paid` seen) but whose payment came
 * through counts as paid too late: everything back.
 */
export function causeOf(booking: PaymentBookingRow): CancellationCause {
  if (!booking.was_paid) return { by: 'LATE_PAYMENT' };
  const renterCancelled =
    booking.close_reason === 'RENTER' ||
    (booking.close_reason === 'ACCOUNT_DELETED' &&
      booking.erased_user_id === booking.renter_id);
  if (renterCancelled && booking.closed_at && booking.start_at) {
    return {
      by: 'RENTER',
      cancelledAt: booking.closed_at,
      start: booking.start_at,
    };
  }
  return { by: 'NOT_RENTER' };
}

/** A paid booking closed: plan its refund (and any share for the lender). */
export async function planCancellation(
  tx: EntityManager,
  payment: PaymentRow,
  booking: PaymentBookingRow,
  cause: CancellationCause,
): Promise<void> {
  const plan = cancellationPlan(amountsOf(payment), cause);
  await planMovement(tx, payment, {
    kind: 'REFUND',
    purpose: cause.by === 'LATE_PAYMENT' ? 'LATE_PAYMENT' : 'CANCELLATION',
    amountCents: plan.refundCents,
    recipientId: booking.renter_id,
  });
  await planMovement(tx, payment, {
    kind: 'TRANSFER',
    purpose: 'RENT',
    amountCents: plan.lenderPayoutCents,
    recipientId: booking.lender_id,
  });
  await updatePayment(tx, payment.id, { status: 'NEEDS_REFUND' });
}

/** A paid booking completed: plan the lender's transfer and the deposit's refund. */
export async function planSettlement(
  tx: EntityManager,
  payment: PaymentRow,
  booking: PaymentBookingRow,
): Promise<void> {
  const plan = settlementPlan(amountsOf(payment));
  await planMovement(tx, payment, {
    kind: 'TRANSFER',
    purpose: 'RENT',
    amountCents: plan.transferCents,
    recipientId: booking.lender_id,
  });
  await planMovement(tx, payment, {
    kind: 'REFUND',
    purpose: 'DEPOSIT',
    amountCents: plan.depositRefundCents,
    recipientId: booking.renter_id,
  });
  await finishIfDone(tx, payment.id, booking, {
    correlationId: `settle:${booking.booking_id}`,
  });
}

/**
 * Once every movement of a payment went through (refunds accepted by
 * Stripe, transfers made), marks it REFUNDED or SETTLED and announces it,
 * exactly once (the status change guards the event).
 */
export async function finishIfDone(
  tx: EntityManager,
  paymentId: string,
  booking: PaymentBookingRow,
  cause: { correlationId: string },
): Promise<void> {
  const movements: MoneyMovementRow[] = await tx.query(
    `SELECT * FROM money_movements WHERE payment_id = $1`,
    [paymentId],
  );
  if (movements.some((m) => m.status === 'PENDING' || m.status === 'FAILED')) {
    return;
  }
  const amount = (purpose: MovementPurpose) =>
    movements.find((m) => m.purpose === purpose)?.amount_cents ?? 0;
  const cancelled = movements.some(
    (m) => m.purpose === 'CANCELLATION' || m.purpose === 'LATE_PAYMENT',
  );
  // TypeORM returns [rows, rowCount] for UPDATE.
  const [, changed]: [unknown[], number] = await tx.query(
    cancelled
      ? `UPDATE payments SET status = 'REFUNDED' WHERE id = $1 AND status = 'NEEDS_REFUND'`
      : `UPDATE payments SET status = 'SETTLED' WHERE id = $1 AND status = 'SUCCEEDED'`,
    [paymentId],
  );
  if (changed === 0) return;
  const who = {
    bookingId: booking.booking_id,
    renterId: booking.renter_id,
    lenderId: booking.lender_id,
    itemTitle: booking.item_title,
  };
  await addToOutbox(
    tx,
    cancelled
      ? createEnvelope(
          PaymentRefundedV1,
          {
            ...who,
            amountCents: amount('CANCELLATION') + amount('LATE_PAYMENT'),
          },
          cause,
        )
      : createEnvelope(
          PaymentSettledV1,
          {
            ...who,
            payoutCents: amount('RENT'),
            depositRefundCents: amount('DEPOSIT'),
          },
          cause,
        ),
  );
}

/** Claims movements due to be carried out, leased like the other jobs. */
export async function claimDueMovements(
  tx: EntityManager,
  limit: number,
  leaseMs: number,
): Promise<MoneyMovementRow[]> {
  // TypeORM returns [rows, rowCount] for UPDATE … RETURNING.
  const [rows]: [MoneyMovementRow[], number] = await tx.query(
    `UPDATE money_movements
        SET next_attempt_at = now() + make_interval(secs => $2::float8 / 1000)
      WHERE id IN (SELECT id FROM money_movements
                    WHERE status = 'PENDING' AND next_attempt_at <= now()
                    ORDER BY next_attempt_at
                    LIMIT $1::int
                    FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [limit, leaseMs],
  );
  return rows;
}

export async function lockMovement(
  tx: EntityManager,
  id: string,
): Promise<MoneyMovementRow | null> {
  const [row] = await tx.query(
    `SELECT * FROM money_movements WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return row ?? null;
}

export async function findMovementByStripeObject(
  tx: EntityManager,
  stripeObjectId: string,
): Promise<MoneyMovementRow | null> {
  const [row] = await tx.query(
    `SELECT * FROM money_movements WHERE stripe_object_id = $1`,
    [stripeObjectId],
  );
  return row ?? null;
}

/** Records what Stripe said; FAILED is logged as an error for a person to look at. */
export async function recordMovement(
  tx: EntityManager,
  movement: MoneyMovementRow,
  status: MoneyMovementStatus,
  stripeObjectId: string | null,
): Promise<void> {
  if (status === 'FAILED') {
    logger.error(
      `${movement.kind} ${movement.id} (${movement.purpose}) of booking ${movement.booking_id} failed at Stripe: check it by hand`,
    );
  }
  await tx.query(
    `UPDATE money_movements
        SET status = $2,
            stripe_object_id = COALESCE($3, stripe_object_id),
            done_at = CASE WHEN $2 IN ('SUCCEEDED', 'FAILED') THEN now() ELSE done_at END
      WHERE id = $1`,
    [movement.id, status, stripeObjectId],
  );
}

export async function retryMovementLater(
  tx: EntityManager,
  id: string,
  delayMs: number,
): Promise<void> {
  await tx.query(
    `UPDATE money_movements
        SET next_attempt_at = now() + make_interval(secs => $2::float8 / 1000),
            attempts = attempts + 1
      WHERE id = $1`,
    [id, delayMs],
  );
}

/** Refunds Stripe has accepted for the payment so far, in cents. */
export async function refundedSoFar(
  tx: EntityManager,
  paymentId: string,
): Promise<number> {
  const [row] = await tx.query(
    `SELECT COALESCE(sum(amount_cents), 0)::int AS cents FROM money_movements
      WHERE payment_id = $1 AND kind = 'REFUND'
        AND status IN ('SUBMITTED', 'SUCCEEDED')`,
    [paymentId],
  );
  return row.cents;
}

/** Transfers to `lenderId`, oldest first (export). */
export async function listPayoutsOf(
  tx: EntityManager,
  lenderId: string,
): Promise<MoneyMovementRow[]> {
  return tx.query(
    `SELECT * FROM money_movements
      WHERE recipient_id = $1 AND kind = 'TRANSFER'
      ORDER BY created_at, id`,
    [lenderId],
  );
}
