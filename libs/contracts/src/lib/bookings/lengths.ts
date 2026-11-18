import {
  PRICE_FIELD,
  PRICE_UNITS,
  type ItemPricing,
  type PriceUnit,
} from '../catalog/items';
import { BOOKING_MAX_HOURS, BOOKING_MIN_HOURS } from './periods';

/**
 * How long a booking of an item may be (ADR-0029): whole units of the
 * smallest rate it offers, within its own limits. Shared by Bookings (which
 * enforces it), Catalog (which refuses limits leaving no length) and the PWA's
 * period pickers.
 */

/** A day is 24 hours, a week 7 days, a month 30 days (ADR-0015). */
export const UNIT_HOURS: Record<PriceUnit, number> = {
  HOUR: 1,
  DAY: 24,
  WEEK: 7 * 24,
  MONTH: 30 * 24,
};

/** The smallest unit the rate card offers; free items go by the hour. */
export function bookingUnit(pricing: ItemPricing): PriceUnit {
  if (pricing.free) return 'HOUR';
  return (
    PRICE_UNITS.find((unit) => pricing[PRICE_FIELD[unit]] !== undefined) ??
    'HOUR'
  );
}

export interface BookingLengths {
  /** Bookings last whole ones of this unit. */
  unit: PriceUnit;
  /** The unit in hours. */
  stepHours: number;
  /** The shortest booking: the item's minimum rounded up to whole units. */
  minHours: number;
  /** The longest: the item's maximum (or 90 days) rounded down to whole units. */
  maxHours: number;
  /** False when no length fits (the rounded maximum is below the minimum). */
  bookable: boolean;
}

/** The lengths a booking of an item may have. */
export function bookingLengths(
  pricing: ItemPricing,
  minRentalHours: number | null,
  maxRentalHours: number | null,
): BookingLengths {
  const unit = bookingUnit(pricing);
  const stepHours = UNIT_HOURS[unit];
  const lowest = Math.max(BOOKING_MIN_HOURS, minRentalHours ?? 0);
  const highest = Math.min(
    BOOKING_MAX_HOURS,
    maxRentalHours ?? BOOKING_MAX_HOURS,
  );
  const minHours = Math.ceil(lowest / stepHours) * stepHours;
  const maxHours = Math.floor(highest / stepHours) * stepHours;
  return {
    unit,
    stepHours,
    minHours,
    maxHours,
    bookable: minHours <= maxHours,
  };
}

/** Why `hours` isn't an allowed length, or null if it is. */
export function lengthProblem(
  hours: number,
  lengths: BookingLengths,
): 'notBookable' | 'notWholeUnits' | 'tooShort' | 'tooLong' | null {
  if (!lengths.bookable) return 'notBookable';
  if (hours % lengths.stepHours !== 0) return 'notWholeUnits';
  if (hours < lengths.minHours) return 'tooShort';
  if (hours > lengths.maxHours) return 'tooLong';
  return null;
}
