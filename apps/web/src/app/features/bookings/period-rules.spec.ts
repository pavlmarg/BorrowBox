import {
  dayFullyUnavailable,
  endDayRange,
  endHourOptions,
  limitsFor,
  periodProblem,
  startDayRange,
  startHourOptions,
  suggestedEnd,
  type Interval,
} from './period-rules';

const H = 3_600_000;
// Monday 9 November 2026, 12:20 in Athens (UTC+2).
const now = new Date('2026-11-09T10:20:00Z');
const at = (iso: string) => new Date(iso);
const limits = limitsFor({ minRentalHours: null, maxRentalHours: null });

describe('booking period rules', () => {
  it('narrows the platform limits with the item’s own', () => {
    expect(limits).toEqual({ minHours: 1, maxHours: 2160 });
    expect(limitsFor({ minRentalHours: 4, maxRentalHours: 48 })).toEqual({
      minHours: 4,
      maxHours: 48,
    });
  });

  it('accepts a whole-hour period that starts an hour or more ahead', () => {
    expect(
      periodProblem(
        at('2026-11-09T12:00:00Z'),
        at('2026-11-09T14:00:00Z'),
        now,
        limits,
        [],
      ),
    ).toBeNull();
  });

  it.each([
    ['2026-11-09T11:00:00Z', '2026-11-09T12:00:00Z', 'startTooSoon'],
    ['2027-06-01T10:00:00Z', '2027-06-01T12:00:00Z', 'startTooFar'],
    ['2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z', 'endBeforeStart'],
    ['2026-11-10T10:00:00Z', '2027-03-10T10:00:00Z', 'tooLong'],
  ])('%s → %s is %s', (start, end, problem) => {
    expect(periodProblem(at(start), at(end), now, limits, [])).toBe(problem);
  });

  it('applies the item’s shortest and longest booking', () => {
    const item = limitsFor({ minRentalHours: 4, maxRentalHours: 24 });
    const start = at('2026-11-10T08:00:00Z');
    expect(
      periodProblem(start, new Date(start.getTime() + 2 * H), now, item, []),
    ).toBe('tooShort');
    expect(
      periodProblem(start, new Date(start.getTime() + 25 * H), now, item, []),
    ).toBe('tooLong');
  });

  it('refuses periods that overlap a held one, but may touch it', () => {
    const busy: Interval[] = [
      {
        start: Date.parse('2026-11-10T10:00:00Z'),
        end: Date.parse('2026-11-10T14:00:00Z'),
      },
    ];
    expect(
      periodProblem(
        at('2026-11-10T08:00:00Z'),
        at('2026-11-10T11:00:00Z'),
        now,
        limits,
        busy,
      ),
    ).toBe('taken');
    expect(
      periodProblem(
        at('2026-11-10T08:00:00Z'),
        at('2026-11-10T10:00:00Z'),
        now,
        limits,
        busy,
      ),
    ).toBeNull();
    expect(
      periodProblem(
        at('2026-11-10T14:00:00Z'),
        at('2026-11-10T15:00:00Z'),
        now,
        limits,
        busy,
      ),
    ).toBeNull();
  });

  it('offers today’s start hours from an hour ahead, in Athens time', () => {
    const today = { year: 2026, month: 11, day: 9 };
    const options = startHourOptions(today, now, []);
    expect(options).toHaveLength(24);
    // 12:20 now: 13:00 is less than an hour away, 14:00 is fine.
    expect(options.find((o) => o.hour === 13)?.disabled).toBe(true);
    expect(options.find((o) => o.hour === 14)?.disabled).toBe(false);
    expect(options.find((o) => o.hour === 14)?.instant.toISOString()).toBe(
      '2026-11-09T12:00:00.000Z',
    );
  });

  it('closes end hours that would cross a held period', () => {
    const busy: Interval[] = [
      {
        start: Date.parse('2026-11-10T16:00:00Z'), // 18:00 Athens
        end: Date.parse('2026-11-10T18:00:00Z'),
      },
    ];
    const start = at('2026-11-10T08:00:00Z'); // 10:00 Athens
    const options = endHourOptions(
      { year: 2026, month: 11, day: 10 },
      start,
      now,
      limits,
      busy,
    );
    const open = options.filter((o) => !o.disabled).map((o) => o.hour);
    expect(open).toEqual([11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it('gives the days a booking may start and end on', () => {
    expect(startDayRange(now)).toEqual({
      min: { year: 2026, month: 11, day: 9 },
      max: { year: 2027, month: 5, day: 8 },
    });
    const item = limitsFor({ minRentalHours: 24, maxRentalHours: 72 });
    expect(endDayRange(at('2026-11-10T08:00:00Z'), item)).toEqual({
      min: { year: 2026, month: 11, day: 11 },
      max: { year: 2026, month: 11, day: 13 },
    });
  });

  it('knows a day with no free start hour', () => {
    const day = { year: 2026, month: 11, day: 12 };
    const wholeDay: Interval[] = [
      {
        start: Date.parse('2026-11-11T22:00:00Z'),
        end: Date.parse('2026-11-12T22:00:00Z'),
      },
    ];
    expect(dayFullyUnavailable(day, now, wholeDay)).toBe(true);
    expect(dayFullyUnavailable(day, now, [])).toBe(false);
  });

  it('suggests a day for daily items and the shortest for hourly ones', () => {
    const start = at('2026-11-10T08:00:00Z');
    expect(suggestedEnd(start, false, now, limits, [])?.toISOString()).toBe(
      '2026-11-11T08:00:00.000Z',
    );
    expect(suggestedEnd(start, true, now, limits, [])?.toISOString()).toBe(
      '2026-11-10T09:00:00.000Z',
    );
    // A held period tomorrow morning: falls back to the shortest.
    const busy: Interval[] = [
      {
        start: Date.parse('2026-11-10T20:00:00Z'),
        end: Date.parse('2026-11-11T20:00:00Z'),
      },
    ];
    expect(suggestedEnd(start, false, now, limits, busy)?.toISOString()).toBe(
      '2026-11-10T09:00:00.000Z',
    );
  });
});
