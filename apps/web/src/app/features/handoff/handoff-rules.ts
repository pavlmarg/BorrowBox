import type {
  BookingStatus,
  BookingViewResponse,
  HandoffPhase,
} from '../../api/models';

/**
 * What the booking page shows for the handoff, the condition photos and a
 * damage claim (ADR-0026–0028). Pure functions of the booking and the time,
 * mirroring the server's checks so the page never offers what it refuses.
 */

/** One handoff the caller can take part in now (or soon). */
export interface HandoffAction {
  phase: HandoffPhase;
  /** The lender shows the code at pickup, the renter at return. */
  part: 'SHOW' | 'SCAN';
  /** Null when open now; else when it opens (the pickup, 2 h before the start). */
  opensAt: string | null;
}

const GOING_AHEAD: readonly BookingStatus[] = ['PAID', 'CONFIRMED'];

function partIn(
  phase: HandoffPhase,
  role: BookingViewResponse['role'],
): HandoffAction['part'] {
  const shower = phase === 'PICKUP' ? 'LENDER' : 'RENTER';
  return role === shower ? 'SHOW' : 'SCAN';
}

/**
 * The handoffs that can be scanned, as the server's `assertOpen` allows:
 * the pickup while the booking goes ahead (from 2 h before the start); the
 * return while the item is out, or while the pickup waits for an admin (a
 * return scan proves both, so both are offered then).
 */
export function handoffActions(
  booking: BookingViewResponse,
  now: Date,
): HandoffAction[] {
  const actions: HandoffAction[] = [];
  const goingAhead = GOING_AHEAD.includes(booking.status);
  if (goingAhead) {
    const opens = booking.handoff.pickupOpensAt;
    actions.push({
      phase: 'PICKUP',
      part: partIn('PICKUP', booking.role),
      opensAt: now.getTime() < Date.parse(opens) ? opens : null,
    });
  }
  if (
    booking.status === 'PICKED_UP' ||
    (goingAhead && booking.handoff.review === 'PICKUP_UNCONFIRMED')
  ) {
    actions.push({
      phase: 'RETURN',
      part: partIn('RETURN', booking.role),
      opensAt: null,
    });
  }
  return actions;
}

/** Whether the caller still has to answer "did the handoff happen?". */
export function needsAnswer(booking: BookingViewResponse): boolean {
  const question = booking.handoff.question;
  return question !== null && question.myAnswer === null;
}

/** Where the handoff has started, condition photos can exist. */
const PHOTO_STATUSES: readonly BookingStatus[] = [
  'CONFIRMED',
  'PAID',
  'PICKED_UP',
  'RETURNED',
  'DISPUTED',
  'COMPLETED',
];

/** Whether to load the booking's condition photos at all. */
export function hasPhotos(booking: BookingViewResponse): boolean {
  return (
    PHOTO_STATUSES.includes(booking.status) ||
    (booking.status === 'EXPIRED' && booking.reason === 'NO_HANDOFF')
  );
}

/** A claim can exist only from the return on. */
export function hasClaim(booking: BookingViewResponse): boolean {
  return (
    booking.status === 'RETURNED' ||
    booking.status === 'DISPUTED' ||
    booking.status === 'COMPLETED'
  );
}

/**
 * Whether the lender can report damage now: returned, a deposit to claim
 * from, inside the claim window, no claim yet (ADR-0028).
 */
export function canFileClaim(
  booking: BookingViewResponse,
  hasExistingClaim: boolean,
  now: Date,
): boolean {
  const until = booking.handoff.claimUntil;
  return (
    booking.role === 'LENDER' &&
    booking.status === 'RETURNED' &&
    booking.price.depositCents > 0 &&
    until !== null &&
    now.getTime() < Date.parse(until) &&
    !hasExistingClaim
  );
}
