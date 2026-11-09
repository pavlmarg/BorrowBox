import {
  addDays,
  athensDay,
  athensInstant,
  athensParts,
  compareDays,
  formatAthensPeriod,
  formatAthensTime,
  hourLabel,
} from './athens';

describe('Athens time', () => {
  it('reads the wall-clock time in Athens, summer and winter', () => {
    expect(athensParts(Date.parse('2026-07-01T07:00:00Z'))).toEqual({
      year: 2026,
      month: 7,
      day: 1,
      hour: 10,
      minute: 0,
    });
    expect(athensParts(Date.parse('2026-12-31T22:30:00Z'))).toEqual({
      year: 2027,
      month: 1,
      day: 1,
      hour: 0,
      minute: 30,
    });
  });

  it('turns an Athens hour into a UTC instant', () => {
    expect(
      athensInstant({ year: 2026, month: 7, day: 1 }, 10)?.toISOString(),
    ).toBe('2026-07-01T07:00:00.000Z');
    expect(
      athensInstant({ year: 2026, month: 12, day: 1 }, 0)?.toISOString(),
    ).toBe('2026-11-30T22:00:00.000Z');
  });

  it('has no 03:00 the night the clocks go forward', () => {
    // 29 March 2026: 03:00 jumps to 04:00 in Athens.
    const day = { year: 2026, month: 3, day: 29 };
    expect(athensInstant(day, 3)).toBeNull();
    expect(athensInstant(day, 4)?.toISOString()).toBe(
      '2026-03-29T01:00:00.000Z',
    );
  });

  it('takes the first 03:00 the night the clocks go back', () => {
    // 25 October 2026: 04:00 goes back to 03:00.
    expect(
      athensInstant({ year: 2026, month: 10, day: 25 }, 3)?.toISOString(),
    ).toBe('2026-10-25T00:00:00.000Z');
  });

  it('counts calendar days', () => {
    const day = athensDay(Date.parse('2026-12-31T12:00:00Z'));
    expect(addDays(day, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(compareDays(day, addDays(day, 2))).toBeLessThan(0);
    expect(hourLabel(7)).toBe('07:00');
  });

  it('formats times and periods in Athens time', () => {
    const now = new Date('2026-11-09T10:00:00Z');
    expect(formatAthensTime('2026-11-14T08:00:00Z', 'en-GB', now)).toBe(
      'Sat 14 Nov, 10:00',
    );
    const sameDay = formatAthensPeriod(
      '2026-11-14T08:00:00Z',
      '2026-11-14T16:00:00Z',
      'en-GB',
      now,
    );
    expect(sameDay).toContain('10:00');
    expect(sameDay).toContain('18:00');
    expect(sameDay.match(/14 Nov/g)?.length).toBe(1);
    expect(
      formatAthensPeriod(
        '2027-01-02T08:00:00Z',
        '2027-01-03T08:00:00Z',
        'en-GB',
        now,
      ),
    ).toContain('2027');
  });
});
