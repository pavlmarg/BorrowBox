/**
 * Times in Europe/Athens (ADR-0015): bookings are picked and shown in
 * Athens time, whatever the browser's own time zone, and sent as UTC
 * instants. Built on `Intl` only, so daylight-saving changes come from the
 * browser's time-zone data, not from code here.
 */

export const ATHENS_TIME_ZONE = 'Europe/Athens';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A calendar day, with no time zone of its own. `month` is 1–12. */
export interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface AthensParts extends CalendarDay {
  readonly hour: number;
  readonly minute: number;
}

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: ATHENS_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** The Athens wall-clock time of an instant. */
export function athensParts(instant: Date | number): AthensParts {
  const values: Record<string, number> = {};
  for (const part of PARTS.formatToParts(instant)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values['year'],
    month: values['month'],
    day: values['day'],
    hour: values['hour'],
    minute: values['minute'],
  };
}

/** The Athens calendar day an instant falls on. */
export function athensDay(instant: Date | number): CalendarDay {
  const { year, month, day } = athensParts(instant);
  return { year, month, day };
}

/**
 * The instant at `hour`:00 Athens time on `day`. Null for the hour skipped
 * when the clocks go forward; the hour that happens twice when they go back
 * gives the first of the two.
 */
export function athensInstant(day: CalendarDay, hour: number): Date | null {
  const wall = Date.UTC(day.year, day.month - 1, day.day, hour);
  // Athens is UTC+3 in summer, UTC+2 in winter: +3 is the earlier instant.
  for (const offsetHours of [3, 2]) {
    const instant = wall - offsetHours * HOUR_MS;
    const p = athensParts(instant);
    if (
      p.year === day.year &&
      p.month === day.month &&
      p.day === day.day &&
      p.hour === hour &&
      p.minute === 0
    ) {
      return new Date(instant);
    }
  }
  return null;
}

export function addDays(day: CalendarDay, days: number): CalendarDay {
  const d = new Date(
    Date.UTC(day.year, day.month - 1, day.day) + days * DAY_MS,
  );
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** Negative if `a` is before `b`, 0 on the same day. */
export function compareDays(a: CalendarDay, b: CalendarDay): number {
  return (
    Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)
  );
}

export function sameDay(a: CalendarDay, b: CalendarDay): boolean {
  return compareDays(a, b) === 0;
}

/**
 * Date pickers work with local-midnight `Date`s; only their calendar day
 * matters here, read in the browser's zone (where the picker made it).
 */
export function dayFromPicker(date: Date): CalendarDay {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

export function dayToPicker(day: CalendarDay): Date {
  return new Date(day.year, day.month - 1, day.day);
}

/** `14:00`, always 24-hour. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** e.g. "Sat 14 Nov, 10:00" (the year only when it isn't this year's). */
export function formatAthensTime(
  instant: string | Date,
  locale: string,
  now: Date = new Date(),
): string {
  const date = new Date(instant);
  return new Intl.DateTimeFormat(locale, dateTimeOptions(date, now)).format(
    date,
  );
}

/**
 * A period `[start, end)`, e.g. "Sat 14 Nov, 10:00 – 18:00" or
 * "Sat 14 Nov, 10:00 – Mon 16 Nov, 18:00", in the locale's own style.
 */
export function formatAthensPeriod(
  start: string | Date,
  end: string | Date,
  locale: string,
  now: Date = new Date(),
): string {
  const from = new Date(start);
  const to = new Date(end);
  const yearOf = athensParts(from).year !== athensParts(now).year ? from : to;
  return new Intl.DateTimeFormat(
    locale,
    dateTimeOptions(yearOf, now),
  ).formatRange(from, to);
}

function dateTimeOptions(date: Date, now: Date): Intl.DateTimeFormatOptions {
  const otherYear = athensParts(date).year !== athensParts(now).year;
  return {
    timeZone: ATHENS_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(otherYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  };
}
