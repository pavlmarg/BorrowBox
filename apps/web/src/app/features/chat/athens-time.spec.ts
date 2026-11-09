import {
  athensDayKey,
  athensParts,
  athensToUtc,
  formatAthens,
} from './athens-time';
import { periodProblem } from './period-picker';

describe('Athens time', () => {
  it('turns an Athens day and hour into the moment, winter and summer', () => {
    // Winter: UTC+2.
    expect(
      athensToUtc({ year: 2026, month: 12, day: 1, hour: 10 }).toISOString(),
    ).toBe('2026-12-01T08:00:00.000Z');
    // Summer: UTC+3.
    expect(
      athensToUtc({ year: 2027, month: 7, day: 1, hour: 0 }).toISOString(),
    ).toBe('2027-06-30T21:00:00.000Z');
  });

  it('handles the nights the clocks change', () => {
    // 2027-03-28: 03:00 doesn't exist (03:00 → 04:00); the hour after it.
    expect(
      athensToUtc({ year: 2027, month: 3, day: 28, hour: 3 }).toISOString(),
    ).toBe('2027-03-28T01:00:00.000Z');
    expect(
      athensToUtc({ year: 2027, month: 3, day: 28, hour: 5 }).toISOString(),
    ).toBe('2027-03-28T02:00:00.000Z');
    // 2026-10-25: after the change back, UTC+2 again.
    expect(
      athensToUtc({ year: 2026, month: 10, day: 25, hour: 12 }).toISOString(),
    ).toBe('2026-10-25T10:00:00.000Z');
  });

  it('reads moments back in Athens time', () => {
    expect(athensParts(new Date('2026-12-31T22:30:00.000Z'))).toEqual({
      year: 2027,
      month: 1,
      day: 1,
      hour: 0,
      minute: 30,
    });
    expect(athensDayKey('2026-12-31T22:30:00.000Z')).toBe('2027-01-01');
    expect(formatAthens('2026-12-01T08:05:00.000Z', 'time', 'el-GR')).toBe(
      '10:05',
    );
  });
});

describe('periodProblem', () => {
  const now = Date.parse('2026-11-09T10:00:00.000Z');
  const at = (iso: string) => new Date(iso);

  it('accepts a period within the booking rules', () => {
    expect(
      periodProblem(
        at('2026-11-10T08:00:00.000Z'),
        at('2026-11-10T16:00:00.000Z'),
        now,
      ),
    ).toBeNull();
  });

  it.each([
    ['order', '2026-11-10T08:00:00.000Z', '2026-11-10T08:00:00.000Z'],
    ['tooSoon', '2026-11-09T10:00:00.000Z', '2026-11-09T12:00:00.000Z'],
    ['tooFar', '2027-06-01T08:00:00.000Z', '2027-06-02T08:00:00.000Z'],
    ['tooLong', '2026-11-10T08:00:00.000Z', '2027-02-09T08:00:00.000Z'],
  ])('says %s', (problem, start, end) => {
    expect(periodProblem(at(start), at(end), now)).toBe(problem);
  });
});
