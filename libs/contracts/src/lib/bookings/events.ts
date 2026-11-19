import { defineEvent } from '../events/envelope';
import type {
  BookingCancelReason,
  BookingDeclineReason,
  BookingExpireReason,
} from './bookings';
import type { BookingReviewReason, HandoffPhase } from './handoff';

/**
 * The booking as every `booking.*` event carries it (ADR-0015), so consumers
 * such as Notifications can describe it without their own item read model.
 * No names, emails or locations: consumers know people by id.
 */
export interface BookingSnapshotV1 {
  bookingId: string;
  itemId: string;
  /** The title when the booking was requested. */
  itemTitle: string;
  lenderId: string;
  renterId: string;
  /** ISO-8601 UTC, whole hours, `[start, end)`. */
  start: string;
  end: string;
  rentCents: number;
  depositCents: number;
  /** Present when the price came from the lender's offer (ADR-0018). */
  offerId?: string;
  /**
   * The renter's fee and the lender's deposit fee (ADR-0020), fixed when the
   * booking was requested. Absent on bookings made before Phase 4's checkout;
   * consumers then use `bookingFees(rentCents, depositCents)`.
   */
  feeCents?: number;
  lenderFeeCents?: number;
  /** While the booking waits for payment (`booking.accepted`): its pay-by time. */
  payBy?: string;
}

/** A renter asked to book an item. The lender has 24 hours to answer. */
export type BookingRequestedV1Payload = BookingSnapshotV1;
export const BookingRequestedV1 = defineEvent<BookingRequestedV1Payload>()(
  'booking.requested',
  1,
);

/** The lender accepted a booking with something to pay; it now waits for payment. */
export type BookingAcceptedV1Payload = BookingSnapshotV1;
export const BookingAcceptedV1 = defineEvent<BookingAcceptedV1Payload>()(
  'booking.accepted',
  1,
);

/**
 * The lender accepted a booking with nothing to pay (rent and deposit 0).
 * It goes ahead now: the two people arrange where to meet.
 */
export type BookingConfirmedV1Payload = BookingSnapshotV1;
export const BookingConfirmedV1 = defineEvent<BookingConfirmedV1Payload>()(
  'booking.confirmed',
  1,
);

/**
 * The renter paid an accepted booking (`payment.captured`). It goes ahead:
 * the two people arrange where to meet (ADR-0015).
 */
export type BookingPaidV1Payload = BookingSnapshotV1;
export const BookingPaidV1 = defineEvent<BookingPaidV1Payload>()(
  'booking.paid',
  1,
);

export interface BookingDeclinedV1Payload extends BookingSnapshotV1 {
  reason: BookingDeclineReason;
}
export const BookingDeclinedV1 = defineEvent<BookingDeclinedV1Payload>()(
  'booking.declined',
  1,
);

export interface BookingExpiredV1Payload extends BookingSnapshotV1 {
  reason: BookingExpireReason;
}
export const BookingExpiredV1 = defineEvent<BookingExpiredV1Payload>()(
  'booking.expired',
  1,
);

export interface BookingCancelledV1Payload extends BookingSnapshotV1 {
  reason: BookingCancelReason;
  /**
   * With `ACCOUNT_DELETED`: whose account was erased, so Payments can tell
   * a renter's erasure (their cancellation) from a lender's (ADR-0021).
   */
  erasedUserId?: string;
}
export const BookingCancelledV1 = defineEvent<BookingCancelledV1Payload>()(
  'booking.cancelled',
  1,
);

/**
 * The renter has the item: the pickup was scanned, or both confirmed it
 * (ADR-0026).
 */
export type BookingPickedUpV1Payload = BookingSnapshotV1;
export const BookingPickedUpV1 = defineEvent<BookingPickedUpV1Payload>()(
  'booking.picked_up',
  1,
);

/** The item is back: the return was scanned, or confirmed (ADR-0026). */
export interface BookingReturnedV1Payload extends BookingSnapshotV1 {
  /**
   * Until when the lender can file a damage claim; null when there's no
   * deposit, and `booking.completed` follows straight away.
   */
  claimUntil: string | null;
}
export const BookingReturnedV1 = defineEvent<BookingReturnedV1Payload>()(
  'booking.returned',
  1,
);

/**
 * Nobody scanned a handoff: the people listed are asked whether it
 * happened (round 1 to 3, ADR-0026). Notifications emails them.
 */
export interface BookingHandoffUnconfirmedV1Payload extends BookingSnapshotV1 {
  phase: HandoffPhase;
  round: 1 | 2 | 3;
  /** Those who haven't answered yet (the lender, the renter or both). */
  askUserIds: string[];
  /** When the outcome falls due without the answers. */
  decideAt: string;
}
export const BookingHandoffUnconfirmedV1 =
  defineEvent<BookingHandoffUnconfirmedV1Payload>()(
    'booking.handoff_unconfirmed',
    1,
  );

/**
 * The answers about a handoff disagree or are missing: an admin will look
 * into it (Phase 6). The booking keeps its status meanwhile; no money moves.
 */
export interface BookingReviewRequestedV1Payload extends BookingSnapshotV1 {
  reason: BookingReviewReason;
}
export const BookingReviewRequestedV1 =
  defineEvent<BookingReviewRequestedV1Payload>()('booking.review_requested', 1);

/**
 * The claim window after the return passed (or a dispute was resolved):
 * the lender is paid and the deposit goes back (ADR-0021). Emitted from
 * Phase 5 (handoff); Payments consumes it from Phase 4.
 */
export type BookingCompletedV1Payload = BookingSnapshotV1;
export const BookingCompletedV1 = defineEvent<BookingCompletedV1Payload>()(
  'booking.completed',
  1,
);

/**
 * The lender filed a damage claim within the claim window: settlement waits
 * for the dispute's outcome (ADR-0021). Emitted from Phase 5.
 */
export type BookingDisputedV1Payload = BookingSnapshotV1;
export const BookingDisputedV1 = defineEvent<BookingDisputedV1Payload>()(
  'booking.disputed',
  1,
);
