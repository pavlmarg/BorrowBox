import { defineEvent } from '../events/envelope';
import type {
  BookingCancelReason,
  BookingDeclineReason,
  BookingExpireReason,
} from './bookings';

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
}
export const BookingCancelledV1 = defineEvent<BookingCancelledV1Payload>()(
  'booking.cancelled',
  1,
);
