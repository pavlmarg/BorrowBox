import type { EntityManager } from 'typeorm';
import {
  BookingAcceptedV1,
  BookingCancelledV1,
  BookingConfirmedV1,
  BookingDeclinedV1,
  BookingExpiredV1,
  createEnvelope,
  type BookingCancelReason,
  type BookingDeclineReason,
  type BookingExpireReason,
  type CreateEnvelopeOptions,
  type EventEnvelope,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { assertTransition } from './booking-state';
import {
  findBooking,
  setBookingStatus,
  toSnapshot,
  type BookingRow,
} from './bookings.repository';

/** The status changes Phase 3 makes, each with its event and reason. */
export type BookingMove =
  | { to: 'ACCEPTED' }
  | { to: 'CONFIRMED' }
  | { to: 'DECLINED'; reason: BookingDeclineReason }
  | { to: 'EXPIRED'; reason: BookingExpireReason }
  | { to: 'CANCELLED'; reason: BookingCancelReason };

/**
 * The only way a booking's status changes: checks the state machine, saves
 * the new status and writes its event to the outbox, all in the caller's
 * transaction. The caller holds the row lock.
 *
 * `cause` is the RPC's correlation id, or the event being handled.
 */
export async function moveBooking(
  tx: EntityManager,
  booking: BookingRow,
  move: BookingMove,
  cause: { correlationId: string } | { causedBy: EventEnvelope } | null,
): Promise<BookingRow> {
  assertTransition(booking.status, move.to);
  const reason = 'reason' in move ? move.reason : null;
  await setBookingStatus(tx, booking.id, move.to, reason);

  const snapshot = toSnapshot(booking);
  const options: CreateEnvelopeOptions = cause ?? {};
  await addToOutbox(tx, envelopeFor(move, snapshot, options));
  return (await findBooking(tx, booking.id)) as BookingRow;
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
        { ...snapshot, reason: move.reason },
        options,
      );
  }
}

/**
 * Cancels each of `ids` (open bookings the caller has locked) because the
 * item or an account is gone. Used by the event consumers.
 */
export async function cancelBookings(
  tx: EntityManager,
  ids: string[],
  reason: 'ITEM_DELETED' | 'ACCOUNT_DELETED',
  cause: EventEnvelope,
): Promise<void> {
  for (const id of ids) {
    const booking = (await findBooking(tx, id)) as BookingRow;
    await moveBooking(
      tx,
      booking,
      { to: 'CANCELLED', reason },
      {
        causedBy: cause,
      },
    );
  }
}
