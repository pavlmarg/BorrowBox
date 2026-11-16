/**
 * The handoff rules (ARCHITECTURE.md §5, ADR-0026): when the pickup and the
 * return can be scanned, what happens when nobody scans, and how the two
 * people's answers decide the outcome. Pure functions, shared by Bookings,
 * the gateway and the PWA.
 */

export const HANDOFF_PHASES = ['PICKUP', 'RETURN'] as const;
/** The lender shows the code at pickup, the renter at return. */
export type HandoffPhase = (typeof HANDOFF_PHASES)[number];

/** A QR token is valid this long after it's issued. */
export const HANDOFF_TOKEN_TTL_SECONDS = 45;
/** The showing screen fetches a fresh token this often. */
export const HANDOFF_TOKEN_REFRESH_SECONDS = 30;
/** The 6-digit fallback code's length. */
export const HANDOFF_CODE_LENGTH = 6;
/** Wrong codes allowed per booking and phase… */
export const HANDOFF_CODE_ATTEMPTS = 5;
/** …in this window. */
export const HANDOFF_CODE_WINDOW_SECONDS = 10 * 60;

/** The pickup can be scanned from this long before the start. */
export const PICKUP_OPENS_BEFORE_START_HOURS = 2;
/**
 * Without a scan, both are asked whether the handoff happened, this many
 * hours after the start (pickup) or the end (return). Each round asks only
 * those who haven't answered.
 */
export const HANDOFF_CONFIRM_ROUND_HOURS = [2, 24, 48] as const;
/** If the answers haven't decided it by then, the outcome falls due. */
export const HANDOFF_DECIDE_HOURS = 72;
/** After the return, the lender has this long to file a damage claim. */
export const CLAIM_WINDOW_HOURS = 48;

/** Why a booking waits for an admin (Phase 6's admin area). */
export const BOOKING_REVIEW_REASONS = [
  'PICKUP_UNCONFIRMED',
  'RETURN_UNCONFIRMED',
] as const;
export type BookingReviewReason = (typeof BOOKING_REVIEW_REASONS)[number];

export const HANDOFF_ANSWERS = ['YES', 'NO'] as const;
/** "Did the handoff happen?" */
export type HandoffAnswer = (typeof HANDOFF_ANSWERS)[number];

const HOUR_MS = 3_600_000;
const addHours = (date: Date, hours: number) =>
  new Date(date.getTime() + hours * HOUR_MS);

/** When the pickup scan opens. */
export function pickupOpensAt(start: Date): Date {
  return addHours(start, -PICKUP_OPENS_BEFORE_START_HOURS);
}

/**
 * What the confirmation rounds count from: the start for the pickup; for
 * the return the end, or the pickup if that came later (a pickup confirmed
 * by answers after a short booking already ended).
 */
export function handoffBase(
  phase: HandoffPhase,
  booking: { start: Date; end: Date; pickedUpAt: Date | null },
): Date {
  if (phase === 'PICKUP') return booking.start;
  const picked = booking.pickedUpAt?.getTime() ?? 0;
  return new Date(Math.max(booking.end.getTime(), picked));
}

/** When round `n` (1–3) is due. */
export function confirmRoundAt(base: Date, round: 1 | 2 | 3): Date {
  return addHours(base, HANDOFF_CONFIRM_ROUND_HOURS[round - 1]);
}

/** When the outcome falls due if the answers haven't decided it. */
export function handoffDecideAt(base: Date): Date {
  return addHours(base, HANDOFF_DECIDE_HOURS);
}

/** When the claim window of a booking returned at `returnedAt` closes. */
export function claimUntil(returnedAt: Date): Date {
  return addHours(returnedAt, CLAIM_WINDOW_HOURS);
}

export interface HandoffAnswers {
  lender: HandoffAnswer | null;
  renter: HandoffAnswer | null;
}

/** What the answers decide; `WAIT` until more answers or the deadline. */
export type PickupOutcome = 'PICKED_UP' | 'NO_HANDOFF' | 'REVIEW' | 'WAIT';
export type ReturnOutcome = 'RETURNED' | 'REVIEW' | 'WAIT';

/**
 * A pickup nobody scanned (ADR-0026). Both yes: it happened. Both no, or
 * nobody claims it by the deadline: the booking ends and the renter is
 * refunded. One yes without the other's: an admin decides.
 *
 * @param due whether the deadline (`handoffDecideAt`) has passed
 */
export function pickupOutcome(
  answers: HandoffAnswers,
  due: boolean,
): PickupOutcome {
  const { lender, renter } = answers;
  if (lender === 'YES' && renter === 'YES') return 'PICKED_UP';
  if (lender === 'NO' && renter === 'NO') return 'NO_HANDOFF';
  const yes = lender === 'YES' || renter === 'YES';
  const no = lender === 'NO' || renter === 'NO';
  if (yes && no) return 'REVIEW';
  if (!due) return 'WAIT';
  return yes ? 'REVIEW' : 'NO_HANDOFF';
}

/**
 * A return nobody scanned (ADR-0026). The lender is the one who loses out
 * if it didn't happen, so their yes is enough and their no goes to an
 * admin. Without the lender's answer by the deadline, an admin decides.
 */
export function returnOutcome(
  answers: HandoffAnswers,
  due: boolean,
): ReturnOutcome {
  if (answers.lender === 'YES') return 'RETURNED';
  if (answers.lender === 'NO') return 'REVIEW';
  return due ? 'REVIEW' : 'WAIT';
}
