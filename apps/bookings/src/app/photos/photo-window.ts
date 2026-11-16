import {
  CONDITION_PHOTO_WINDOW_AFTER_HOURS,
  pickupOpensAt,
  type HandoffPhase,
} from '@borrowbox/contracts';
import type { BookingRow } from '../bookings/bookings.repository';

const HOUR_MS = 3_600_000;

/**
 * Whether photos of a handoff can be added or removed now (ADR-0027):
 * - pickup: once the pickup opens (2 hours before the start) while the
 *   booking goes ahead or waits for an admin, until 2 hours after the
 *   pickup was recorded;
 * - return: while the item is out, until 2 hours after the return was
 *   recorded, and while a damage claim is open.
 * Bookings that ended without a pickup take no photos.
 */
export function photosOpen(
  booking: Pick<
    BookingRow,
    'status' | 'start' | 'picked_up_at' | 'returned_at'
  >,
  phase: HandoffPhase,
  now: Date,
): boolean {
  const within = (at: Date | null) =>
    at !== null &&
    now.getTime() < at.getTime() + CONDITION_PHOTO_WINDOW_AFTER_HOURS * HOUR_MS;

  if (phase === 'PICKUP') {
    const goingAhead =
      booking.status === 'PAID' || booking.status === 'CONFIRMED';
    return (
      (goingAhead && now.getTime() >= pickupOpensAt(booking.start).getTime()) ||
      within(booking.picked_up_at)
    );
  }
  return (
    booking.status === 'PICKED_UP' ||
    booking.status === 'DISPUTED' ||
    within(booking.returned_at)
  );
}
