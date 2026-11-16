import type { EntityManager } from 'typeorm';
import type { ClaimExport, ClaimStatus, ClaimView } from '@borrowbox/contracts';

/** A damage claim (ADR-0028); one per booking. */
export interface ClaimRow {
  booking_id: string;
  amount_cents: number;
  description: string | null;
  photo_ids: string[];
  status: ClaimStatus;
  reply: string | null;
  filed_at: Date;
  answered_at: Date | null;
  resolved_at: Date | null;
  award_cents: number | null;
}

const SELECT_CLAIMS = `
  SELECT booking_id, amount_cents, description, photo_ids, status, reply,
         filed_at, answered_at, resolved_at, award_cents
    FROM claims`;

export async function insertClaim(
  tx: EntityManager,
  c: {
    bookingId: string;
    amountCents: number;
    description: string;
    photoIds: string[];
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO claims (booking_id, amount_cents, description, photo_ids)
     VALUES ($1, $2, $3, $4::uuid[])`,
    [c.bookingId, c.amountCents, c.description, c.photoIds],
  );
}

export async function findClaim(
  tx: EntityManager,
  bookingId: string,
): Promise<ClaimRow | null> {
  const [row] = await tx.query(SELECT_CLAIMS + ' WHERE booking_id = $1', [
    bookingId,
  ]);
  return row ?? null;
}

/** The renter disagrees: an admin decides. */
export async function markDisagreed(
  tx: EntityManager,
  bookingId: string,
  reply: string | null,
): Promise<void> {
  await tx.query(
    `UPDATE claims SET status = 'DISAGREED', reply = $2, answered_at = now()
      WHERE booking_id = $1`,
    [bookingId, reply],
  );
}

export async function markResolved(
  tx: EntityManager,
  bookingId: string,
  status: 'AGREED' | 'WITHDRAWN' | 'DECIDED',
  awardCents: number,
  reply: string | null,
): Promise<void> {
  await tx.query(
    `UPDATE claims
        SET status = $2, award_cents = $3, resolved_at = now(),
            reply = COALESCE($4, reply),
            answered_at = CASE WHEN $2 = 'AGREED' THEN now() ELSE answered_at END
      WHERE booking_id = $1`,
    [bookingId, status, awardCents, reply],
  );
}

/** Which of the booking's ready condition photos exist among `ids`. */
export async function readyPhotosOf(
  tx: EntityManager,
  bookingId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows: Array<{ id: string }> = await tx.query(
    `SELECT id FROM condition_photos
      WHERE booking_id = $1 AND status = 'READY' AND id = ANY($2::uuid[])`,
    [bookingId, ids],
  );
  return rows.map((r) => r.id);
}

/**
 * Account erasure: the person's claim texts go (the lender's descriptions,
 * the renter's replies); amounts and outcomes stay as financial records.
 */
export async function blankClaimTextsOf(
  tx: EntityManager,
  userId: string,
): Promise<void> {
  await tx.query(
    `UPDATE claims c SET description = NULL
       FROM bookings b
      WHERE b.id = c.booking_id AND b.lender_id = $1`,
    [userId],
  );
  await tx.query(
    `UPDATE claims c SET reply = NULL
       FROM bookings b
      WHERE b.id = c.booking_id AND b.renter_id = $1`,
    [userId],
  );
}

/** Claims on the user's bookings, with only their own text, for `GET /me/export`. */
export async function listClaimsForExport(
  tx: EntityManager,
  userId: string,
): Promise<ClaimExport[]> {
  const rows: Array<ClaimRow & { lender_id: string; renter_id: string }> =
    await tx.query(
      `SELECT c.*, b.lender_id, b.renter_id FROM claims c
       JOIN bookings b ON b.id = c.booking_id
      WHERE b.lender_id = $1 OR b.renter_id = $1
      ORDER BY c.filed_at`,
      [userId],
    );
  return rows.map((r) => {
    const role = r.lender_id === userId ? 'LENDER' : 'RENTER';
    return {
      bookingId: r.booking_id,
      role,
      amountCents: r.amount_cents,
      status: r.status,
      awardCents: r.award_cents,
      filedAt: r.filed_at.toISOString(),
      resolvedAt: r.resolved_at?.toISOString() ?? null,
      myText: role === 'LENDER' ? r.description : r.reply,
    };
  });
}

export function toClaimView(row: ClaimRow): ClaimView {
  return {
    bookingId: row.booking_id,
    amountCents: row.amount_cents,
    description: row.description ?? '',
    photoIds: row.photo_ids,
    status: row.status,
    reply: row.reply,
    filedAt: row.filed_at.toISOString(),
    answeredAt: row.answered_at?.toISOString() ?? null,
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    awardCents: row.award_cents,
  };
}
