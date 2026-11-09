import {
  BOOKING_MAX_AHEAD_DAYS,
  BOOKING_MAX_HOURS,
  BOOKING_MIN_HOURS,
  BOOKING_MIN_LEAD_HOURS,
} from '@borrowbox/contracts';
import type { BookingPeriodResponse } from '../../api/models';
import {
  athensDay,
  athensInstant,
  compareDays,
  type CalendarDay,
} from '../../shared/format/athens';

/**
 * The booking period rules (ADR-0015), checked in the browser so the picker
 * only offers what Bookings will accept. Bookings checks them again; these
 * only save a round trip.
 */

const HOUR_MS = 3_600_000;

/** A held period in epoch ms, `[start, end)`. */
export interface Interval {
  readonly start: number;
  readonly end: number;
}

export interface PeriodLimits {
  readonly minHours: number;
  readonly maxHours: number;
}

/** The platform's limits, narrowed by the item's own (Catalog). */
export function limitsFor(item: {
  minRentalHours: number | null;
  maxRentalHours: number | null;
}): PeriodLimits {
  const minHours = Math.max(BOOKING_MIN_HOURS, item.minRentalHours ?? 0);
  const maxHours = Math.min(
    BOOKING_MAX_HOURS,
    item.maxRentalHours ?? BOOKING_MAX_HOURS,
  );
  return { minHours, maxHours: Math.max(minHours, maxHours) };
}

export function toIntervals(periods: BookingPeriodResponse[]): Interval[] {
  return periods.map((p) => ({
    start: Date.parse(p.start),
    end: Date.parse(p.end),
  }));
}

export type PeriodProblem =
  | 'startTooSoon'
  | 'startTooFar'
  | 'endBeforeStart'
  | 'tooShort'
  | 'tooLong'
  | 'taken';

export function earliestStart(now: Date): number {
  return now.getTime() + BOOKING_MIN_LEAD_HOURS * HOUR_MS;
}

export function latestStart(now: Date): number {
  return now.getTime() + BOOKING_MAX_AHEAD_DAYS * 24 * HOUR_MS;
}

function overlaps(start: number, end: number, busy: Interval[]): boolean {
  return busy.some((b) => start < b.end && b.start < end);
}

function startProblem(
  start: number,
  now: Date,
  busy: Interval[],
): PeriodProblem | null {
  if (start < earliestStart(now)) return 'startTooSoon';
  if (start > latestStart(now)) return 'startTooFar';
  if (overlaps(start, start + HOUR_MS, busy)) return 'taken';
  return null;
}

/** What's wrong with a period, or null if Bookings should accept it. */
export function periodProblem(
  start: Date,
  end: Date,
  now: Date,
  limits: PeriodLimits,
  busy: Interval[],
): PeriodProblem | null {
  const s = start.getTime();
  const e = end.getTime();
  const fromStart = startProblem(s, now, busy);
  if (fromStart) return fromStart;
  if (e <= s) return 'endBeforeStart';
  const hours = Math.round((e - s) / HOUR_MS);
  if (hours < limits.minHours) return 'tooShort';
  if (hours > limits.maxHours) return 'tooLong';
  if (overlaps(s, e, busy)) return 'taken';
  return null;
}

export interface HourOption {
  readonly hour: number;
  readonly instant: Date;
  readonly disabled: boolean;
}

/** A day's hours that exist in Athens (none skipped by daylight saving). */
function hoursOf(day: CalendarDay): Array<{ hour: number; instant: Date }> {
  const hours: Array<{ hour: number; instant: Date }> = [];
  for (let hour = 0; hour < 24; hour++) {
    const instant = athensInstant(day, hour);
    if (instant) hours.push({ hour, instant });
  }
  return hours;
}

/** Start hours on a day: too soon, too far or taken ones are disabled. */
export function startHourOptions(
  day: CalendarDay,
  now: Date,
  busy: Interval[],
): HourOption[] {
  return hoursOf(day).map(({ hour, instant }) => ({
    hour,
    instant,
    disabled: startProblem(instant.getTime(), now, busy) !== null,
  }));
}

/** End hours on a day for a chosen start. */
export function endHourOptions(
  day: CalendarDay,
  start: Date,
  now: Date,
  limits: PeriodLimits,
  busy: Interval[],
): HourOption[] {
  return hoursOf(day).map(({ hour, instant }) => ({
    hour,
    instant,
    disabled: periodProblem(start, instant, now, limits, busy) !== null,
  }));
}

/** Days a booking may start on: today (Athens) to 180 days ahead. */
export function startDayRange(now: Date): {
  min: CalendarDay;
  max: CalendarDay;
} {
  return {
    min: athensDay(earliestStart(now)),
    max: athensDay(latestStart(now)),
  };
}

/** Days a booking that starts at `start` may end on. */
export function endDayRange(
  start: Date,
  limits: PeriodLimits,
): { min: CalendarDay; max: CalendarDay } {
  return {
    min: athensDay(start.getTime() + limits.minHours * HOUR_MS),
    max: athensDay(start.getTime() + limits.maxHours * HOUR_MS),
  };
}

/** True when no hour of the day could start a booking. */
export function dayFullyUnavailable(
  day: CalendarDay,
  now: Date,
  busy: Interval[],
): boolean {
  return startHourOptions(day, now, busy).every((o) => o.disabled);
}

export function dayWithin(
  day: CalendarDay,
  range: { min: CalendarDay; max: CalendarDay },
): boolean {
  return compareDays(day, range.min) >= 0 && compareDays(day, range.max) <= 0;
}

/**
 * The end to suggest once a start is picked: a day for items without an
 * hourly rate, the shortest allowed booking otherwise, kept within the
 * item's limits and clear of held periods when possible.
 */
export function suggestedEnd(
  start: Date,
  hourly: boolean,
  now: Date,
  limits: PeriodLimits,
  busy: Interval[],
): Date | null {
  const wanted = hourly ? limits.minHours : Math.max(24, limits.minHours);
  const hours = Math.min(wanted, limits.maxHours);
  for (const h of [hours, limits.minHours]) {
    const end = new Date(start.getTime() + h * HOUR_MS);
    if (periodProblem(start, end, now, limits, busy) === null) return end;
  }
  return null;
}
