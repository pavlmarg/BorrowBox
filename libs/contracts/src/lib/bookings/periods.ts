/**
 * Booking periods (ADR-0015): whole hours. Shared with Catalog, whose items
 * may narrow the length further (`minRentalHours`, `maxRentalHours`).
 */

/** The shortest booking. */
export const BOOKING_MIN_HOURS = 1;
/** The longest booking: 90 days. */
export const BOOKING_MAX_HOURS = 90 * 24;
/** A booking starts at least this many hours from now. */
export const BOOKING_MIN_LEAD_HOURS = 1;
/** …and at most this many days ahead. */
export const BOOKING_MAX_AHEAD_DAYS = 180;
/** A request with no answer expires after this, or at its start if sooner. */
export const BOOKING_ANSWER_HOURS = 24;
/** How many `REQUESTED` bookings a renter may have open at once. */
export const BOOKING_OPEN_REQUESTS_MAX = 10;

const HOUR_MS = 60 * 60 * 1000;

/** True if `date` is exactly on a UTC hour (and so on an Athens hour too). */
export function isWholeHour(date: Date): boolean {
  return date.getTime() % HOUR_MS === 0;
}

/** Whole hours from `start` to `end`; the caller checks both are whole hours. */
export function hoursBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / HOUR_MS);
}
