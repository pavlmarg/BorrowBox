import {
  BOOKING_MAX_AHEAD_DAYS,
  bookingLengths,
  hoursBetween,
  isWholeHour,
  lengthProblem,
  type ItemPricing,
  type PriceUnit,
} from '@borrowbox/contracts';
import { BookingsError } from '../rpc/rpc-errors';

const HOUR_MS = 60 * 60 * 1000;

export interface Period {
  start: Date;
  end: Date;
  hours: number;
}

/**
 * The item's rate card, whose smallest unit bookings come in (ADR-0029), and
 * its own shortest and longest booking, in hours (null = no limit).
 */
export interface RentalLimits {
  pricing: ItemPricing;
  minRentalHours: number | null;
  maxRentalHours: number | null;
}

const UNIT_NAMES: Record<PriceUnit, string> = {
  HOUR: 'hours',
  DAY: 'days',
  WEEK: 'weeks',
  MONTH: 'months (30 days)',
};

const invalid = (message: string) =>
  new BookingsError('INVALID_PERIOD', message);

/**
 * Checks a requested period against ADR-0015 and the item's limits:
 * whole hours, starting after `now` (on a whole hour still to come,
 * ADR-0029) and at most 180 days ahead, lasting 1 hour to 90 days and within
 * the item's own limits, in whole units of its smallest rate. Offers ask for more notice (`minLeadHours`,
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
  const lengths = bookingLengths(
    limits.pricing,
    limits.minRentalHours,
    limits.maxRentalHours,
  );
  switch (lengthProblem(hours, lengths)) {
    case 'notBookable':
      throw invalid('No booking length fits this item right now');
    case 'notWholeUnits':
      throw invalid(`This item is booked in whole ${UNIT_NAMES[lengths.unit]}`);
    case 'tooShort':
    case 'tooLong':
      throw invalid(
        `This item can be booked for ${lengths.minHours} to ${lengths.maxHours} hours`,
      );
  }
  return { start, end, hours };
}
