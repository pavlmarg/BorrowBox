import type { EntityManager } from 'typeorm';
import {
  BookingAcceptedV1,
  BookingCancelledV1,
  BookingConfirmedV1,
  BookingDeclinedV1,
  BookingExpiredV1,
  BookingPaidV1,
  createEnvelope,
  PAYMENT_WINDOW_HOURS,
  type BookingCancelReason,
  type BookingDeclineReason,
  type BookingExpireReason,
  type CreateEnvelopeOptions,
  type EventEnvelope,
  type SystemMessageCode,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import type { ChatPushes } from '../messaging/chat-publisher';
import { addBookingLine } from '../messaging/system-messages';
import { assertTransition } from './booking-state';
import {
  findBooking,
  lockOverlappingRequests,
  setBookingStatus,
  setPayBy,
  toSnapshot,
  type BookingRow,
} from './bookings.repository';

/** The status changes Bookings makes, each with its event and reason. */
export type BookingMove =
  | { to: 'ACCEPTED' }
  | { to: 'CONFIRMED' }
  | { to: 'PAID' }
  | { to: 'DECLINED'; reason: BookingDeclineReason }
  | { to: 'EXPIRED'; reason: BookingExpireReason }
  | {
      to: 'CANCELLED';
      reason: BookingCancelReason;
      /** With ACCOUNT_DELETED: whose account was erased (ADR-0021). */
      erasedUserId?: string;
    };

export type Cause = { correlationId: string } | { causedBy: EventEnvelope };

const LINES: Record<BookingMove['to'], SystemMessageCode> = {
  ACCEPTED: 'BOOKING_ACCEPTED',
  CONFIRMED: 'BOOKING_CONFIRMED',
  PAID: 'BOOKING_PAID',
  DECLINED: 'BOOKING_DECLINED',
  EXPIRED: 'BOOKING_EXPIRED',
  CANCELLED: 'BOOKING_CANCELLED',
};

/**
 * The only way a booking's status changes: checks the state machine, saves
 * the new status, writes its event to the outbox and marks the moment in
 * the conversation (ADR-0017), all in the caller's transaction. The caller
 * holds the row lock.
 *
 * `cause` is the RPC's correlation id, or the event being handled.
 */
export async function moveBooking(
  tx: EntityManager,
  booking: BookingRow,
  move: BookingMove,
  cause: Cause | null,
  pushes: ChatPushes | null = null,
): Promise<BookingRow> {
  assertTransition(booking.status, move.to);
  const reason = 'reason' in move ? move.reason : null;
  await setBookingStatus(tx, booking.id, move.to, reason);

  const snapshot = toSnapshot(booking);
  // Waiting for payment: Payments and Notifications need the pay-by time.
  if (move.to === 'ACCEPTED' && booking.pay_by) {
    snapshot.payBy = booking.pay_by.toISOString();
  }
  const options: CreateEnvelopeOptions = cause ?? {};
  await addToOutbox(tx, envelopeFor(move, snapshot, options));
  await addBookingLine(tx, booking, LINES[move.to], pushes);
  return (await findBooking(tx, booking.id)) as BookingRow;
}

/** True if accepting the booking means the renter pays something. */
export function hasSomethingToPay(b: {
  rent_cents: number;
  deposit_cents: number;
}): boolean {
  return b.rent_cents + b.deposit_cents > 0;
}

/** When an accepted booking must be paid: 24 hours from now, or its start if sooner. */
export function payByFor(start: Date, now = new Date()): Date {
  return new Date(
    Math.min(
      now.getTime() + PAYMENT_WINDOW_HOURS * 60 * 60 * 1000,
      start.getTime(),
    ),
  );
}

/**
 * Accepts a locked `REQUESTED` booking: `CONFIRMED` if there's nothing to
 * pay, else `ACCEPTED` with a pay-by time (ADR-0019), and declines the
 * item's other overlapping requests (ADR-0015). The caller holds the item's
 * booking lock and has checked that the lender can be paid. A double
 * booking fails on the exclusion constraint (23P01).
 */
export async function acceptBooking(
  tx: EntityManager,
  booking: BookingRow,
  cause: Cause,
  pushes: ChatPushes | null,
): Promise<BookingRow> {
  const free = !hasSomethingToPay(booking);
  if (!free) {
    await setPayBy(tx, booking.id, payByFor(booking.start));
    booking = (await findBooking(tx, booking.id)) as BookingRow;
  }
  const accepted = await moveBooking(
    tx,
    booking,
    { to: free ? 'CONFIRMED' : 'ACCEPTED' },
    cause,
    pushes,
  );
  const overlapping = await lockOverlappingRequests(
    tx,
    booking.item_id,
    booking.start,
    booking.end,
    booking.id,
  );
  for (const id of overlapping) {
    await moveBooking(
      tx,
      (await findBooking(tx, id)) as BookingRow,
      { to: 'DECLINED', reason: 'OVERLAP' },
      cause,
      pushes,
    );
  }
  return accepted;
}

function envelopeFor(
  move: BookingMove,
  snapshot: ReturnType<typeof toSnapshot>,
  options: CreateEnvelopeOptions,
): EventEnvelope {
  switch (move.to) {
    case 'ACCEPTED':
      return createEnvelope(BookingAcceptedV1, snapshot, options);
    case 'CONFIRMED':
      return createEnvelope(BookingConfirmedV1, snapshot, options);
    case 'PAID':
      return createEnvelope(BookingPaidV1, snapshot, options);
    case 'DECLINED':
      return createEnvelope(
        BookingDeclinedV1,
        { ...snapshot, reason: move.reason },
        options,
      );
    case 'EXPIRED':
      return createEnvelope(
        BookingExpiredV1,
        { ...snapshot, reason: move.reason },
        options,
      );
    case 'CANCELLED':
      return createEnvelope(
        BookingCancelledV1,
        {
          ...snapshot,
          reason: move.reason,
          ...(move.erasedUserId ? { erasedUserId: move.erasedUserId } : {}),
        },
        options,
      );
  }
}

/**
 * Cancels each of `ids` (open or paid bookings the caller has locked)
 * because the item or an account is gone. Used by the event consumers;
 * `erasedUserId` names the erased account for ACCOUNT_DELETED.
 */
export async function cancelBookings(
  tx: EntityManager,
  ids: string[],
  reason: 'ITEM_DELETED' | 'ACCOUNT_DELETED',
  cause: EventEnvelope,
  pushes: ChatPushes | null,
  erasedUserId?: string,
): Promise<void> {
  for (const id of ids) {
    const booking = (await findBooking(tx, id)) as BookingRow;
    await moveBooking(
      tx,
      booking,
      { to: 'CANCELLED', reason, ...(erasedUserId ? { erasedUserId } : {}) },
      { causedBy: cause },
      pushes,
    );
  }
}
