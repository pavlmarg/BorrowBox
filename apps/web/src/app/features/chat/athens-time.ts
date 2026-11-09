import { Pipe, inject, type PipeTransform } from '@angular/core';
import { LanguageService } from '../../core/i18n/language';

/** Bookings and chat show times in Greece's time (ADR-0015). */
export const ATHENS = 'Europe/Athens';

export interface AthensParts {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  /** 0–23. */
  hour: number;
}

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: ATHENS,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

/** The calendar day and hour a moment has in Athens. */
export function athensParts(date: Date): AthensParts & { minute: number } {
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(PARTS.formatToParts(date).find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/** Minutes Athens is ahead of UTC at that moment (120 or 180). */
function athensOffsetMinutes(utcMs: number): number {
  const p = athensParts(new Date(utcMs));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(utcMs / 60_000) * 60_000) / 60_000);
}

/**
 * The moment a calendar day and hour in Athens stand for. In the hour
 * skipped when clocks go forward, the answer is the hour after it.
 */
export function athensToUtc(parts: AthensParts): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour);
  let utc = naive - athensOffsetMinutes(naive) * 60_000;
  // Near a clock change the offset at the guess may differ: check once more.
  utc = naive - athensOffsetMinutes(utc) * 60_000;
  return new Date(utc);
}

export type AthensFormat = 'time' | 'day' | 'dateTime' | 'date';

const OPTIONS: Record<AthensFormat, Intl.DateTimeFormatOptions> = {
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  day: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  dateTime: {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  },
  date: { day: 'numeric', month: 'short' },
};

const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatAthens(
  iso: string | Date,
  format: AthensFormat,
  locale: string,
): string {
  const key = `${locale}|${format}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      ...OPTIONS[format],
      timeZone: ATHENS,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** The Athens calendar day of a moment, as `YYYY-MM-DD` (for grouping). */
export function athensDayKey(iso: string): string {
  const p = athensParts(new Date(iso));
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * `{{ iso | athens: 'time' }}`: a time in Athens, in the UI language. Not
 * pure, so it follows a language switch.
 */
@Pipe({ name: 'athens', pure: false })
export class AthensPipe implements PipeTransform {
  private readonly language = inject(LanguageService);

  transform(
    iso: string | null | undefined,
    format: AthensFormat = 'dateTime',
  ): string {
    return iso ? formatAthens(iso, format, this.language.formatLocale()) : '';
  }
}
