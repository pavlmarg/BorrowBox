import {
  BOOKING_MAX_AHEAD_DAYS,
  BOOKING_MAX_HOURS,
  BOOKING_MIN_HOURS,
  hoursBetween,
  isWholeHour,
} from '@borrowbox/contracts';
import { BookingsError } from '../rpc/rpc-errors';

const HOUR_MS = 60 * 60 * 1000;

export interface Period {
  start: Date;
  end: Date;
  hours: number;
}

/** The item's own shortest and longest booking, in hours (null = no limit). */
export interface RentalLimits {
  minRentalHours: number | null;
  maxRentalHours: number | null;
}

const invalid = (message: string) =>
  new BookingsError('INVALID_PERIOD', message);

/**
 * Checks a requested period against ADR-0015 and the item's limits:
 * whole hours, starting after `now` (on a whole hour still to come,
 * ADR-0029) and at most 180 days ahead, lasting 1 hour to 90 days and within
 * the item's own limits. Offers ask for more notice (`minLeadHours`,
 * ADR-0018). The DTO has already checked that both are ISO-8601 instants.
 */
export function checkPeriod(
  startIso: string,
  endIso: string,
  now: Date,
  limits: RentalLimits,
  minLeadHours = 0,
): Period {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!isWholeHour(start) || !isWholeHour(end)) {
    throw invalid('Bookings start and end on the hour');
  }
  if (end <= start) throw invalid('A booking must end after it starts');
  if (start.getTime() <= now.getTime()) {
    throw invalid('A booking must start in the future');
  }
  if (start.getTime() < now.getTime() + minLeadHours * HOUR_MS) {
    throw invalid(`This must start at least ${minLeadHours} hour from now`);
  }
  if (start.getTime() > now.getTime() + BOOKING_MAX_AHEAD_DAYS * 24 * HOUR_MS) {
    throw invalid(
      `A booking can start at most ${BOOKING_MAX_AHEAD_DAYS} days ahead`,
    );
  }

  const hours = hoursBetween(start, end);
  const min = Math.max(BOOKING_MIN_HOURS, limits.minRentalHours ?? 0);
  const max = Math.min(
    BOOKING_MAX_HOURS,
    limits.maxRentalHours ?? BOOKING_MAX_HOURS,
  );
  if (hours < min || hours > max) {
    throw invalid(`This item can be booked for ${min} to ${max} hours`);
  }
  return { start, end, hours };
}
