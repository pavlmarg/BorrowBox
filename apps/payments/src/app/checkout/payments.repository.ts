import type { EntityManager } from 'typeorm';
import type { PaymentStatus } from '@borrowbox/contracts';
import type { PaymentBookingRow } from './bookings.repository';

/** One payment per booking (ADR-0019). Amounts in integer cents. */
export interface PaymentRow {
  id: string;
  booking_id: string;
  renter_id: string;
  rent_cents: number;
  deposit_cents: number;
  fee_cents: number;
  lender_fee_cents: number;
  amount_cents: number;
  stripe_payment_intent_id: string | null;
  status: PaymentStatus;
  last_attempt_failed: boolean;
  created_at: Date;
  paid_at: Date | null;
  stripe_cancel_pending: boolean;
  stripe_cancel_attempts: number;
  /** The charge transfers are paid from (ADR-0021). */
  stripe_charge_id: string | null;
  /** Planned so far (never more than the charge together). */
  refunded_cents: number;
  transferred_cents: number;
}

export async function findPaymentByBooking(
  tx: EntityManager,
  bookingId: string,
): Promise<PaymentRow | null> {
  const [row] = await tx.query(`SELECT * FROM payments WHERE booking_id = $1`, [
    bookingId,
  ]);
  return row ?? null;
}

export async function lockPaymentByIntent(
  tx: EntityManager,
  intentId: string,
): Promise<PaymentRow | null> {
  const [row] = await tx.query(
    `SELECT * FROM payments WHERE stripe_payment_intent_id = $1 FOR UPDATE`,
    [intentId],
  );
  return row ?? null;
}

export async function lockPaymentByBooking(
  tx: EntityManager,
  bookingId: string,
): Promise<PaymentRow | null> {
  const [row] = await tx.query(
    `SELECT * FROM payments WHERE booking_id = $1 FOR UPDATE`,
    [bookingId],
  );
  return row ?? null;
}

/** The booking's payment, created once from its amounts; a second call keeps the first. */
export async function ensurePayment(
  tx: EntityManager,
  id: string,
  booking: PaymentBookingRow,
): Promise<PaymentRow> {
  await tx.query(
    `INSERT INTO payments (id, booking_id, renter_id, rent_cents, deposit_cents,
                           fee_cents, lender_fee_cents, amount_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (booking_id) DO NOTHING`,
    [
      id,
      booking.booking_id,
      booking.renter_id,
      booking.rent_cents,
      booking.deposit_cents,
      booking.fee_cents,
      booking.lender_fee_cents,
      booking.rent_cents + booking.deposit_cents + booking.fee_cents,
    ],
  );
  return (await findPaymentByBooking(tx, booking.booking_id)) as PaymentRow;
}

/** Saves the PaymentIntent's id the first time; later calls keep it. */
export async function setPaymentIntent(
  tx: EntityManager,
  paymentId: string,
  intentId: string,
): Promise<void> {
  await tx.query(
    `UPDATE payments SET stripe_payment_intent_id = $2
      WHERE id = $1 AND stripe_payment_intent_id IS NULL`,
    [paymentId, intentId],
  );
}

export async function updatePayment(
  tx: EntityManager,
  id: string,
  changes: {
    status?: PaymentStatus;
    lastAttemptFailed?: boolean;
    paid?: boolean;
    cancelPending?: boolean;
    chargeId?: string | null;
  },
): Promise<void> {
  await tx.query(
    `UPDATE payments
        SET status = COALESCE($2, status),
            last_attempt_failed = COALESCE($3, last_attempt_failed),
            paid_at = CASE WHEN $4 THEN COALESCE(paid_at, now()) ELSE paid_at END,
            stripe_cancel_pending = COALESCE($5, stripe_cancel_pending),
            next_stripe_cancel_at = CASE WHEN $5 THEN now()
                                         ELSE next_stripe_cancel_at END,
            stripe_charge_id = COALESCE($6, stripe_charge_id)
      WHERE id = $1`,
    [
      id,
      changes.status ?? null,
      changes.lastAttemptFailed ?? null,
      changes.paid ?? false,
      changes.cancelPending ?? null,
      changes.chargeId ?? null,
    ],
  );
}

export interface CancelJob {
  id: string;
  booking_id: string;
  stripe_payment_intent_id: string | null;
  stripe_cancel_attempts: number;
}

/** Claims PaymentIntents due to be cancelled at Stripe, leased like the other jobs. */
export async function claimDueCancels(
  tx: EntityManager,
  limit: number,
  leaseMs: number,
): Promise<CancelJob[]> {
  // TypeORM returns [rows, rowCount] for UPDATE … RETURNING.
  const [rows]: [CancelJob[], number] = await tx.query(
    `UPDATE payments
        SET next_stripe_cancel_at = now() + make_interval(secs => $2::float8 / 1000)
      WHERE id IN (SELECT id FROM payments
                    WHERE stripe_cancel_pending AND next_stripe_cancel_at <= now()
                    ORDER BY next_stripe_cancel_at
                    LIMIT $1::int
                    FOR UPDATE SKIP LOCKED)
      RETURNING id, booking_id, stripe_payment_intent_id, stripe_cancel_attempts`,
    [limit, leaseMs],
  );
  return rows;
}

export async function retryCancelLater(
  tx: EntityManager,
  id: string,
  delayMs: number,
): Promise<void> {
  await tx.query(
    `UPDATE payments
        SET next_stripe_cancel_at = now() + make_interval(secs => $2::float8 / 1000),
            stripe_cancel_attempts = stripe_cancel_attempts + 1
      WHERE id = $1`,
    [id, delayMs],
  );
}

/** The renter's payments, oldest first (export). */
export async function listPaymentsOf(
  tx: EntityManager,
  renterId: string,
): Promise<PaymentRow[]> {
  return tx.query(
    `SELECT * FROM payments WHERE renter_id = $1 ORDER BY created_at, id`,
    [renterId],
  );
}
