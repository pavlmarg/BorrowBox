import type { EntityManager } from 'typeorm';
import {
  BookingHandoffUnconfirmedV1,
  BookingReviewRequestedV1,
  confirmRoundAt,
  createEnvelope,
  handoffBase,
  handoffDecideAt,
  pickupOutcome,
  returnOutcome,
  type CreateEnvelopeOptions,
  type HandoffAnswers,
  type HandoffMethod,
  type HandoffPhase,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { moveBooking, type Cause } from '../bookings/booking-transitions';
import {
  currentPhase,
  findBooking,
  toSnapshot,
  type BookingRow,
} from '../bookings/bookings.repository';
import type { ChatPushes } from '../messaging/chat-publisher';
import { addBookingLine } from '../messaging/system-messages';
import { insertHandoff, setReview, setRounds } from './handoff.repository';

/**
 * The handoff timeline (ADR-0026), on a booking the caller has locked:
 * - a returned booking completes when its claim window closes;
 * - a handoff nobody scanned asks both, in up to three rounds, whether it
 *   happened, then the answers (or their absence by the deadline) decide:
 *   it happened, it didn't (`NO_HANDOFF`), or an admin looks into it.
 *
 * Re-reads nothing itself and does nothing early, so a job that fires late,
 * twice, or after a scan does nothing wrong. Returns the booking as it is
 * now; its `handoff_due_at` is when to look again.
 */
export async function advanceHandoff(
  tx: EntityManager,
  row: BookingRow,
  now: Date,
  cause: Cause | null,
  pushes: ChatPushes | null,
): Promise<BookingRow> {
  if (row.status === 'RETURNED') {
    if (row.claim_until && row.claim_until.getTime() <= now.getTime()) {
      return moveBooking(tx, row, { to: 'COMPLETED' }, cause, pushes, now);
    }
    return row;
  }
  const phase = currentPhase(row);
  if (!phase || row.review_reason) return row;

  const base = handoffBase(phase, {
    start: row.start,
    end: row.end,
    pickedUpAt: row.picked_up_at,
  });
  const decideAt = handoffDecideAt(base);
  const due = decideAt.getTime() <= now.getTime();
  const decided = await applyAnswers(tx, row, phase, due, now, cause, pushes);
  if (decided) return decided;

  // Still open: ask in the latest round due, if not asked yet.
  let round = 0;
  for (const r of [1, 2, 3] as const) {
    if (confirmRoundAt(base, r).getTime() <= now.getTime()) round = r;
  }
  if (round > row.handoff_rounds) {
    const answers = answersOf(row);
    const askUserIds = [
      ...(answers.lender ? [] : [row.lender_id]),
      ...(answers.renter ? [] : [row.renter_id]),
    ];
    await addToOutbox(
      tx,
      createEnvelope(
        BookingHandoffUnconfirmedV1,
        {
          ...toSnapshot(row),
          phase,
          round: round as 1 | 2 | 3,
          askUserIds,
          decideAt: decideAt.toISOString(),
        },
        options(cause),
      ),
    );
  }
  const rounds = Math.max(round, row.handoff_rounds);
  const next =
    rounds < 3 ? confirmRoundAt(base, (rounds + 1) as 1 | 2 | 3) : decideAt;
  await setRounds(tx, row.id, rounds, next);
  return (await findBooking(tx, row.id)) as BookingRow;
}

/**
 * Acts on the answers if they decide the handoff (`due`: the deadline has
 * passed). @returns the booking after acting, or null if still open
 */
export async function applyAnswers(
  tx: EntityManager,
  row: BookingRow,
  phase: HandoffPhase,
  due: boolean,
  now: Date,
  cause: Cause | null,
  pushes: ChatPushes | null,
): Promise<BookingRow | null> {
  const answers = answersOf(row);
  if (phase === 'PICKUP') {
    switch (pickupOutcome(answers, due)) {
      case 'PICKED_UP':
        return recordPickup(
          tx,
          row,
          'CONFIRMED',
          null,
          null,
          now,
          cause,
          pushes,
        );
      case 'NO_HANDOFF':
        return moveBooking(
          tx,
          row,
          { to: 'EXPIRED', reason: 'NO_HANDOFF' },
          cause,
          pushes,
          now,
        );
      case 'REVIEW':
        return requestReview(tx, row, 'PICKUP_UNCONFIRMED', cause, pushes);
      case 'WAIT':
        return null;
    }
  }
  switch (returnOutcome(answers, due)) {
    case 'RETURNED':
      return recordReturn(tx, row, 'CONFIRMED', null, null, now, cause, pushes);
    case 'REVIEW':
      return requestReview(tx, row, 'RETURN_UNCONFIRMED', cause, pushes);
    case 'WAIT':
      return null;
  }
}

/** The pickup happened: recorded, then `PICKED_UP`. */
export async function recordPickup(
  tx: EntityManager,
  row: BookingRow,
  method: HandoffMethod,
  shownBy: string | null,
  scannedBy: string | null,
  now: Date,
  cause: Cause | null,
  pushes: ChatPushes | null,
): Promise<BookingRow> {
  await insertHandoff(tx, {
    bookingId: row.id,
    phase: 'PICKUP',
    method,
    shownBy,
    scannedBy,
    at: now,
  });
  return moveBooking(tx, row, { to: 'PICKED_UP' }, cause, pushes, now);
}

/**
 * The item is back: recorded, then `RETURNED`; without a deposit there's
 * nothing to claim, so it completes straight away (ADR-0026).
 */
export async function recordReturn(
  tx: EntityManager,
  row: BookingRow,
  method: HandoffMethod,
  shownBy: string | null,
  scannedBy: string | null,
  now: Date,
  cause: Cause | null,
  pushes: ChatPushes | null,
): Promise<BookingRow> {
  await insertHandoff(tx, {
    bookingId: row.id,
    phase: 'RETURN',
    method,
    shownBy,
    scannedBy,
    at: now,
  });
  const returned = await moveBooking(
    tx,
    row,
    { to: 'RETURNED' },
    cause,
    pushes,
    now,
  );
  if (returned.deposit_cents > 0) return returned;
  return moveBooking(tx, returned, { to: 'COMPLETED' }, cause, pushes, now);
}

/** The answers disagree or are missing: an admin decides (Phase 6). */
async function requestReview(
  tx: EntityManager,
  row: BookingRow,
  reason: 'PICKUP_UNCONFIRMED' | 'RETURN_UNCONFIRMED',
  cause: Cause | null,
  pushes: ChatPushes | null,
): Promise<BookingRow> {
  await setReview(tx, row.id, reason);
  await addToOutbox(
    tx,
    createEnvelope(
      BookingReviewRequestedV1,
      { ...toSnapshot(row), reason },
      options(cause),
    ),
  );
  await addBookingLine(tx, row, 'BOOKING_IN_REVIEW', pushes);
  return (await findBooking(tx, row.id)) as BookingRow;
}

export function answersOf(row: BookingRow): HandoffAnswers {
  const answers = row.answers ?? {};
  return {
    lender: answers[row.lender_id] ?? null,
    renter: answers[row.renter_id] ?? null,
  };
}

function options(cause: Cause | null): CreateEnvelopeOptions {
  return cause ?? {};
}
