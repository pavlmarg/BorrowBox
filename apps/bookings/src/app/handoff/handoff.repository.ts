import type { EntityManager } from 'typeorm';
import type {
  BookingHandoffExport,
  BookingReviewReason,
  BookingStatus,
  HandoffAnswer,
  HandoffMethod,
  HandoffPhase,
} from '@borrowbox/contracts';

/**
 * Handoff rows, answers and timeline columns (ADR-0026). Status changes
 * stay in `moveBooking`; this only records what goes with them.
 */

/** The handoff columns after a move to `status`; see `moveBooking`. */
export interface HandoffTimes {
  pickedUpAt?: Date;
  returnedAt?: Date;
  claimUntil?: Date | null;
  /** Null: nothing more to check. */
  dueAt: Date | null;
  /** Reset the rounds and the review flag (a new handoff starts, or none). */
  reset: boolean;
}

export async function setHandoffTimes(
  tx: EntityManager,
  id: string,
  t: HandoffTimes,
): Promise<void> {
  await tx.query(
    `UPDATE bookings
        SET picked_up_at   = COALESCE($2, picked_up_at),
            returned_at    = COALESCE($3, returned_at),
            claim_until    = CASE WHEN $4::boolean THEN $5::timestamptz
                                  ELSE claim_until END,
            handoff_due_at = $6,
            handoff_rounds = CASE WHEN $7::boolean THEN 0 ELSE handoff_rounds END,
            review_reason  = CASE WHEN $7::boolean THEN NULL ELSE review_reason END
      WHERE id = $1`,
    [
      id,
      t.pickedUpAt ?? null,
      t.returnedAt ?? null,
      t.claimUntil !== undefined,
      t.claimUntil ?? null,
      t.dueAt,
      t.reset,
    ],
  );
}

/** After a round of questions: how many were sent, and the next check. */
export async function setRounds(
  tx: EntityManager,
  id: string,
  rounds: number,
  dueAt: Date | null,
): Promise<void> {
  await tx.query(
    `UPDATE bookings SET handoff_rounds = $2, handoff_due_at = $3 WHERE id = $1`,
    [id, rounds, dueAt],
  );
}

/** An admin has to decide; the timeline stops until then (Phase 6). */
export async function setReview(
  tx: EntityManager,
  id: string,
  reason: BookingReviewReason,
): Promise<void> {
  await tx.query(
    `UPDATE bookings
        SET review_reason = $2, handoff_due_at = NULL, updated_at = now()
      WHERE id = $1`,
    [id, reason],
  );
}

/** Records how a handoff happened. Once per booking and phase. */
export async function insertHandoff(
  tx: EntityManager,
  h: {
    bookingId: string;
    phase: HandoffPhase;
    method: HandoffMethod;
    shownBy: string | null;
    scannedBy: string | null;
    at: Date;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO handoffs (booking_id, phase, method, shown_by, scanned_by, at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (booking_id, phase) DO NOTHING`,
    [h.bookingId, h.phase, h.method, h.shownBy, h.scannedBy, h.at],
  );
}

/**
 * Saves an answer unless the user already gave one for this handoff.
 * @returns the answer on record (theirs from before, or this one)
 */
export async function saveAnswer(
  tx: EntityManager,
  a: {
    bookingId: string;
    phase: HandoffPhase;
    userId: string;
    answer: HandoffAnswer;
  },
): Promise<HandoffAnswer> {
  await tx.query(
    `INSERT INTO handoff_answers (booking_id, phase, user_id, answer)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (booking_id, phase, user_id) DO NOTHING`,
    [a.bookingId, a.phase, a.userId, a.answer],
  );
  const [row] = await tx.query(
    `SELECT answer FROM handoff_answers
      WHERE booking_id = $1 AND phase = $2 AND user_id = $3`,
    [a.bookingId, a.phase, a.userId],
  );
  return row.answer;
}

/** Bookings whose handoff timeline is due: a lost job's work for the sweeper. */
export async function listDueHandoffs(
  tx: EntityManager,
  limit: number,
  now: Date,
): Promise<string[]> {
  const rows: Array<{ id: string }> = await tx.query(
    `SELECT id FROM bookings WHERE handoff_due_at <= $2
      ORDER BY handoff_due_at LIMIT $1::int`,
    [limit, now],
  );
  return rows.map((r) => r.id);
}

/** Statuses during which an item is out (ADR-0026's erasure guard). */
export const ACTIVE_RENTAL_STATUSES: BookingStatus[] = [
  'PICKED_UP',
  'RETURNED',
  'DISPUTED',
];

export async function hasActiveRentals(
  tx: EntityManager,
  userId: string,
): Promise<boolean> {
  const rows: unknown[] = await tx.query(
    `SELECT 1 FROM bookings
      WHERE (renter_id = $1 OR lender_id = $1) AND status = ANY($2::text[])
      LIMIT 1`,
    [userId, ACTIVE_RENTAL_STATUSES],
  );
  return rows.length > 0;
}

/** The user's handoffs and answers, for `GET /me/export`. */
export async function listHandoffsForExport(
  tx: EntityManager,
  userId: string,
): Promise<BookingHandoffExport[]> {
  const rows: Array<{
    booking_id: string;
    phase: HandoffPhase;
    method: HandoffMethod | null;
    at: Date | null;
    answer: HandoffAnswer | null;
    answered_at: Date | null;
  }> = await tx.query(
    `SELECT COALESCE(h.booking_id, a.booking_id) AS booking_id,
            COALESCE(h.phase, a.phase) AS phase,
            h.method, h.at, a.answer, a.answered_at
       FROM (SELECT h.* FROM handoffs h
               JOIN bookings b ON b.id = h.booking_id
              WHERE b.renter_id = $1 OR b.lender_id = $1) h
       FULL JOIN (SELECT * FROM handoff_answers WHERE user_id = $1) a
         ON a.booking_id = h.booking_id AND a.phase = h.phase
      ORDER BY 1, 2`,
    [userId],
  );
  return rows.map((r) => ({
    bookingId: r.booking_id,
    phase: r.phase,
    method: r.method,
    at: r.at?.toISOString() ?? null,
    answer: r.answer,
    answeredAt: r.answered_at?.toISOString() ?? null,
  }));
}
