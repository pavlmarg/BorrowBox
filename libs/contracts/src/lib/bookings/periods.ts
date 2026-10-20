/**
 * Booking periods (ADR-0015): whole hours. Shared with Catalog, whose items
 * may narrow the length further (`minRentalHours`, `maxRentalHours`).
 */

/** The shortest booking. */
export const BOOKING_MIN_HOURS = 1;
/** The longest booking: 90 days. */
export const BOOKING_MAX_HOURS = 90 * 24;
