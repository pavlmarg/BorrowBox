import type { EntityManager } from 'typeorm';
import { bookingFees, type BookingSnapshotV1 } from '@borrowbox/contracts';

/**
 * Payments' read model of the bookings it takes money for, from Bookings'
 * events. They may arrive out of order (retries, several queues), so the
 * state only moves forward: AWAITING_PAYMENT → PAID → CLOSED, and CLOSED
 * from either. A late `booking.accepted` never reopens a closed booking.
 */
export type BookingPaymentState = 'AWAITING_PAYMENT' | 'PAID' | 'CLOSED';

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
  status: BookingPaymentState;
}

const RANK: Record<BookingPaymentState, number> = {
  AWAITING_PAYMENT: 0,
  PAID: 1,
  CLOSED: 2,
};

/** Saves what the event says about the booking, moving its state forward only. */
export async function saveBooking(
  tx: EntityManager,
  b: BookingSnapshotV1,
  state: BookingPaymentState,
): Promise<void> {
  // Bookings made before checkout don't carry their fees: today's rule.
  const fees =
    b.feeCents === undefined || b.lenderFeeCents === undefined
      ? bookingFees(b.rentCents, b.depositCents)
      : null;
  await tx.query(
    `INSERT INTO bookings (booking_id, renter_id, lender_id, item_title,
                           rent_cents, deposit_cents, fee_cents,
                           lender_fee_cents, pay_by, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (booking_id) DO UPDATE
       SET status = EXCLUDED.status,
           pay_by = COALESCE(EXCLUDED.pay_by, bookings.pay_by),
           updated_at = now()
       WHERE (CASE bookings.status
                WHEN 'AWAITING_PAYMENT' THEN 0 WHEN 'PAID' THEN 1 ELSE 2 END)
           < $11`,
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
      state,
      RANK[state],
    ],
  );
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
