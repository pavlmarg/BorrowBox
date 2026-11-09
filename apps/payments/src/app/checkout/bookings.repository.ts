import type { EntityManager } from 'typeorm';
import { bookingFees, type BookingSnapshotV1 } from '@borrowbox/contracts';

/**
 * Payments' read model of the bookings it takes money for, from Bookings'
 * events. They may arrive out of order (retries, several queues), so the
 * state only moves forward: AWAITING_PAYMENT, PAID, DISPUTED, then
 * COMPLETED or CLOSED (both final). A late `booking.accepted` never reopens
 * a closed booking.
 */
export type BookingPaymentState =
  'AWAITING_PAYMENT' | 'PAID' | 'DISPUTED' | 'COMPLETED' | 'CLOSED';

export interface PaymentBookingRow {
  booking_id: string;
  renter_id: string;
  lender_id: string;
  item_title: string;
  rent_cents: number;
  deposit_cents: number;
  fee_cents: number;
  lender_fee_cents: number;
  pay_by: Date | null;
  start_at: Date | null;
  status: BookingPaymentState;
  closed_at: Date | null;
  close_reason: string | null;
  erased_user_id: string | null;
  /** booking.paid was seen (the booking went ahead before it closed). */
  was_paid: boolean;
}

const RANK: Record<BookingPaymentState, number> = {
  AWAITING_PAYMENT: 0,
  PAID: 1,
  DISPUTED: 2,
  COMPLETED: 3,
  CLOSED: 3,
};

/** How a booking closed (`booking.expired` / `.cancelled`). */
export interface BookingClose {
  occurredAt: string;
  reason: string;
  erasedUserId?: string;
}

/**
 * Saves what the event says about the booking, moving its state forward
 * only. Returns true if the state changed (a first event, or a move
 * forward), so money is planned once, on the real transition.
 */
export async function saveBooking(
  tx: EntityManager,
  b: BookingSnapshotV1,
  state: BookingPaymentState,
  close: BookingClose | null = null,
): Promise<boolean> {
  // Bookings made before checkout don't carry their fees: today's rule.
  const fees =
    b.feeCents === undefined || b.lenderFeeCents === undefined
      ? bookingFees(b.rentCents, b.depositCents)
      : null;
  const inserted: unknown[] = await tx.query(
    `INSERT INTO bookings (booking_id, renter_id, lender_id, item_title,
                           rent_cents, deposit_cents, fee_cents,
                           lender_fee_cents, pay_by, start_at, status,
                           closed_at, close_reason, erased_user_id, was_paid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (booking_id) DO NOTHING
     RETURNING booking_id`,
    [
      b.bookingId,
      b.renterId,
      b.lenderId,
      b.itemTitle,
      b.rentCents,
      b.depositCents,
      b.feeCents ?? fees?.renterFeeCents,
      b.lenderFeeCents ?? fees?.lenderFeeCents,
      b.payBy ?? null,
      b.start,
      state,
      close?.occurredAt ?? null,
      close?.reason ?? null,
      close?.erasedUserId ?? null,
      state === 'PAID',
    ],
  );
  // Whatever the order: the start is known, and having been paid sticks.
  await tx.query(
    `UPDATE bookings
        SET start_at = COALESCE(start_at, $2),
            was_paid = was_paid OR $3
      WHERE booking_id = $1`,
    [b.bookingId, b.start, state === 'PAID'],
  );
  if (inserted.length > 0) return true;
  // TypeORM returns [rows, rowCount] for UPDATE.
  const [, moved]: [unknown[], number] = await tx.query(
    `UPDATE bookings
        SET status = $2,
            pay_by = COALESCE($3, pay_by),
            closed_at = COALESCE($4, closed_at),
            close_reason = COALESCE($5, close_reason),
            erased_user_id = COALESCE($6, erased_user_id),
            updated_at = now()
      WHERE booking_id = $1
        AND (CASE status WHEN 'AWAITING_PAYMENT' THEN 0 WHEN 'PAID' THEN 1
                         WHEN 'DISPUTED' THEN 2 ELSE 3 END) < $7`,
    [
      b.bookingId,
      state,
      b.payBy ?? null,
      close?.occurredAt ?? null,
      close?.reason ?? null,
      close?.erasedUserId ?? null,
      RANK[state],
    ],
  );
  return moved > 0;
}

export async function findBooking(
  tx: EntityManager,
  bookingId: string,
): Promise<PaymentBookingRow | null> {
  const [row] = await tx.query(`SELECT * FROM bookings WHERE booking_id = $1`, [
    bookingId,
  ]);
  return row ?? null;
}

/** Locks the booking's row until the transaction ends, then reads it. */
export async function lockBooking(
  tx: EntityManager,
  bookingId: string,
): Promise<PaymentBookingRow | null> {
  const [row] = await tx.query(
    `SELECT * FROM bookings WHERE booking_id = $1 FOR UPDATE`,
    [bookingId],
  );
  return row ?? null;
}
