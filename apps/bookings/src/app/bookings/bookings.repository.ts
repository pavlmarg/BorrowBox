import type { EntityManager } from 'typeorm';
import {
  BOOKING_HOLDING_STATUSES,
  type BookingCloseReason,
  type BookingSnapshotV1,
  type BookingStatus,
  type BookingView,
  type ItemPricing,
  type PriceUnits,
} from '@borrowbox/contracts';
import { OPEN_STATUSES } from './booking-state';

/** A booking with its people's names (null if deleted or not known yet). */
export interface BookingRow {
  id: string;
  item_id: string;
  lender_id: string;
  renter_id: string;
  item_title: string;
  pricing: ItemPricing;
  units: PriceUnits;
  rent_cents: number;
  deposit_cents: number;
  start: Date;
  end: Date;
  status: BookingStatus;
  reason: BookingCloseReason | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  renter_name: string | null;
  lender_name: string | null;
}

export interface NewBooking {
  id: string;
  itemId: string;
  lenderId: string;
  renterId: string;
  itemTitle: string;
  pricing: ItemPricing;
  units: PriceUnits;
  rentCents: number;
  depositCents: number;
  start: Date;
  end: Date;
  expiresAt: Date;
}

const SELECT_BOOKINGS = `
  SELECT b.id, b.item_id, b.lender_id, b.renter_id, b.item_title, b.pricing,
         b.units, b.rent_cents, b.deposit_cents,
         lower(b.period) AS start, upper(b.period) AS "end",
         b.status, b.reason, b.expires_at, b.created_at, b.updated_at,
         r.display_name AS renter_name, l.display_name AS lender_name
    FROM bookings b
    LEFT JOIN users r ON r.user_id = b.renter_id
    LEFT JOIN users l ON l.user_id = b.lender_id`;

/** Statuses that hold the item's period, as a Postgres array literal parameter. */
const HOLDING: string[] = [...BOOKING_HOLDING_STATUSES];
const OPEN: string[] = [...OPEN_STATUSES];

export async function insertBooking(
  tx: EntityManager,
  b: NewBooking,
): Promise<void> {
  await tx.query(
    `INSERT INTO bookings (id, item_id, lender_id, renter_id, item_title,
                           pricing, units, rent_cents, deposit_cents, period,
                           status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             tstzrange($10, $11, '[)'), 'REQUESTED', $12)`,
    [
      b.id,
      b.itemId,
      b.lenderId,
      b.renterId,
      b.itemTitle,
      JSON.stringify(b.pricing),
      JSON.stringify(b.units),
      b.rentCents,
      b.depositCents,
      b.start,
      b.end,
      b.expiresAt,
    ],
  );
}

export async function findBooking(
  tx: EntityManager,
  id: string,
): Promise<BookingRow | null> {
  const [row] = await tx.query(SELECT_BOOKINGS + ' WHERE b.id = $1', [id]);
  return row ?? null;
}

/** Locks the booking row until the transaction ends, then reads it. */
export async function lockBooking(
  tx: EntityManager,
  id: string,
): Promise<BookingRow | null> {
  const locked: unknown[] = await tx.query(
    `SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return locked.length > 0 ? findBooking(tx, id) : null;
}

/**
 * Serialises accepting requests per item, so two overlapping accepts can't
 * deadlock while each declines the other. The exclusion constraint stays
 * the real guard against double booking.
 */
export async function lockItemBookings(
  tx: EntityManager,
  itemId: string,
): Promise<void> {
  // 2002: this lock's namespace among Bookings' advisory locks.
  await tx.query(`SELECT pg_advisory_xact_lock(2002, hashtext($1))`, [itemId]);
}

/** Only state changes go through here; callers check the state machine first. */
export async function setBookingStatus(
  tx: EntityManager,
  id: string,
  status: BookingStatus,
  reason: BookingCloseReason | null,
): Promise<void> {
  await tx.query(
    `UPDATE bookings
        SET status = $2, reason = $3, updated_at = now(),
            expires_at = CASE WHEN $2 = 'REQUESTED' THEN expires_at END
      WHERE id = $1`,
    [id, status, reason],
  );
}

/** Other `REQUESTED` bookings of the item overlapping `[start, end)`, locked. */
export async function lockOverlappingRequests(
  tx: EntityManager,
  itemId: string,
  start: Date,
  end: Date,
  exceptId: string,
): Promise<string[]> {
  const rows: Array<{ id: string }> = await tx.query(
    `SELECT id FROM bookings
      WHERE item_id = $1 AND status = 'REQUESTED' AND id <> $4
        AND period && tstzrange($2, $3, '[)')
      ORDER BY id
      FOR UPDATE`,
    [itemId, start, end, exceptId],
  );
  return rows.map((r) => r.id);
}

/** Open bookings (`REQUESTED`, `ACCEPTED`, `CONFIRMED`) matching `where`, locked. */
export async function lockOpenBookings(
  tx: EntityManager,
  where: { itemId: string } | { userId: string },
): Promise<string[]> {
  const rows: Array<{ id: string }> = await tx.query(
    'itemId' in where
      ? `SELECT id FROM bookings
          WHERE item_id = $1 AND status = ANY($2::text[])
          ORDER BY id FOR UPDATE`
      : `SELECT id FROM bookings
          WHERE (renter_id = $1 OR lender_id = $1) AND status = ANY($2::text[])
          ORDER BY id FOR UPDATE`,
    ['itemId' in where ? where.itemId : where.userId, OPEN],
  );
  return rows.map((r) => r.id);
}

export async function countOpenRequests(
  tx: EntityManager,
  renterId: string,
): Promise<number> {
  const [row] = await tx.query(
    `SELECT count(*)::int AS n FROM bookings
      WHERE renter_id = $1 AND status = 'REQUESTED'`,
    [renterId],
  );
  return row.n;
}

/** True if the renter already has a live booking of the item overlapping the period. */
export async function hasOverlappingOwnBooking(
  tx: EntityManager,
  renterId: string,
  itemId: string,
  start: Date,
  end: Date,
): Promise<boolean> {
  const rows: unknown[] = await tx.query(
    `SELECT 1 FROM bookings
      WHERE renter_id = $1 AND item_id = $2
        AND status = ANY($5::text[])
        AND period && tstzrange($3, $4, '[)')
      LIMIT 1`,
    [renterId, itemId, start, end, ['REQUESTED', ...HOLDING]],
  );
  return rows.length > 0;
}

/** True if a booking already holds part of the period. */
export async function isPeriodTaken(
  tx: EntityManager,
  itemId: string,
  start: Date,
  end: Date,
): Promise<boolean> {
  const rows: unknown[] = await tx.query(
    `SELECT 1 FROM bookings
      WHERE item_id = $1 AND status = ANY($4::text[])
        AND period && tstzrange($2, $3, '[)')
      LIMIT 1`,
    [itemId, start, end, HOLDING],
  );
  return rows.length > 0;
}

/** Periods held from now on, earliest first. */
export async function busyPeriods(
  tx: EntityManager,
  itemId: string,
): Promise<Array<{ start: Date; end: Date }>> {
  return tx.query(
    `SELECT lower(period) AS start, upper(period) AS "end" FROM bookings
      WHERE item_id = $1 AND status = ANY($2::text[])
        AND upper(period) > now()
      ORDER BY lower(period)`,
    [itemId, HOLDING],
  );
}

/** A page of the user's bookings in one role, newest first (keyset on created_at, id). */
export async function listBookings(
  tx: EntityManager,
  query: {
    userId: string;
    role: 'RENTER' | 'LENDER';
    statuses: BookingStatus[] | null;
    after: { createdAt: Date; id: string } | null;
    limit: number;
  },
): Promise<BookingRow[]> {
  const column = query.role === 'RENTER' ? 'b.renter_id' : 'b.lender_id';
  return tx.query(
    SELECT_BOOKINGS +
      ' WHERE ' +
      column +
      ` = $1
        AND ($2::text[] IS NULL OR b.status = ANY($2::text[]))
        AND ($3::timestamptz IS NULL OR (b.created_at, b.id) < ($3, $4::uuid))
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT $5::int`,
    [
      query.userId,
      query.statuses,
      query.after?.createdAt ?? null,
      query.after?.id ?? null,
      query.limit,
    ],
  );
}

/** Every booking of the user in one role, oldest first (for the data export). */
export async function listAllBookings(
  tx: EntityManager,
  userId: string,
  role: 'RENTER' | 'LENDER',
): Promise<BookingRow[]> {
  const column = role === 'RENTER' ? 'b.renter_id' : 'b.lender_id';
  return tx.query(
    SELECT_BOOKINGS + ' WHERE ' + column + ' = $1 ORDER BY b.created_at, b.id',
    [userId],
  );
}

/** Bookings due to expire: unanswered requests past their deadline, unpaid ones past their start. */
export async function listDueExpiries(
  tx: EntityManager,
  limit: number,
): Promise<string[]> {
  const rows: Array<{ id: string }> = await tx.query(
    `SELECT id FROM bookings WHERE status = 'REQUESTED' AND expires_at <= now()
     UNION
     SELECT id FROM bookings WHERE status = 'ACCEPTED' AND lower(period) <= now()
     LIMIT $1::int`,
    [limit],
  );
  return rows.map((r) => r.id);
}

export function toSnapshot(row: BookingRow): BookingSnapshotV1 {
  return {
    bookingId: row.id,
    itemId: row.item_id,
    itemTitle: row.item_title,
    lenderId: row.lender_id,
    renterId: row.renter_id,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
    rentCents: row.rent_cents,
    depositCents: row.deposit_cents,
  };
}

/** The booking as `userId` (one of its two people) sees it. */
export function toView(row: BookingRow, userId: string): BookingView {
  return {
    id: row.id,
    role: row.renter_id === userId ? 'RENTER' : 'LENDER',
    itemId: row.item_id,
    itemTitle: row.item_title,
    renter: { userId: row.renter_id, displayName: row.renter_name },
    lender: { userId: row.lender_id, displayName: row.lender_name },
    start: row.start.toISOString(),
    end: row.end.toISOString(),
    status: row.status,
    price: {
      rentCents: row.rent_cents,
      depositCents: row.deposit_cents,
      totalCents: row.rent_cents + row.deposit_cents,
      units: row.units,
    },
    pricing: row.pricing,
    reason: row.reason,
    expiresAt:
      row.status === 'REQUESTED' && row.expires_at
        ? row.expires_at.toISOString()
        : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
