import { BookingsError } from '../rpc/rpc-errors';
import { checkPeriod, type RentalLimits } from './period';

const NOW = new Date('2026-11-01T10:20:00Z');
const NO_LIMITS: RentalLimits = { minRentalHours: null, maxRentalHours: null };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof BookingsError ? err.code : 'not a BookingsError';
  }
  return undefined;
}

describe('checkPeriod', () => {
  it('accepts whole hours starting at least an hour from now', () => {
    expect(
      checkPeriod(
        '2026-11-01T12:00:00Z',
        '2026-11-01T15:00:00Z',
        NOW,
        NO_LIMITS,
      ),
    ).toEqual({
      start: new Date('2026-11-01T12:00:00Z'),
      end: new Date('2026-11-01T15:00:00Z'),
      hours: 3,
    });
  });

  it.each([
    ['not on the hour', '2026-11-01T12:30:00Z', '2026-11-01T15:00:00Z'],
    ['ending before it starts', '2026-11-01T15:00:00Z', '2026-11-01T12:00:00Z'],
    ['empty', '2026-11-01T12:00:00Z', '2026-11-01T12:00:00Z'],
    ['less than an hour ahead', '2026-11-01T11:00:00Z', '2026-11-01T13:00:00Z'],
    [
      'more than 180 days ahead',
      '2027-05-01T12:00:00Z',
      '2027-05-01T13:00:00Z',
    ],
    ['longer than 90 days', '2026-11-02T00:00:00Z', '2027-02-01T00:00:00Z'],
  ])('rejects a period %s', (_, start, end) => {
    expect(codeOf(() => checkPeriod(start, end, NOW, NO_LIMITS))).toBe(
      'INVALID_PERIOD',
    );
  });

  it('accepts exactly 180 days ahead and exactly 90 days long', () => {
    const start = new Date(NOW.getTime() + 180 * 24 * 3600_000);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 90 * 24 * 3600_000);
    expect(
      checkPeriod(start.toISOString(), end.toISOString(), NOW, NO_LIMITS).hours,
    ).toBe(2160);
  });

  it("applies the item's own limits", () => {
    const limits = { minRentalHours: 24, maxRentalHours: 48 };
    const at = (end: string) => () =>
      checkPeriod('2026-11-02T00:00:00Z', end, NOW, limits);
    expect(codeOf(at('2026-11-02T23:00:00Z'))).toBe('INVALID_PERIOD');
    expect(codeOf(at('2026-11-03T00:00:00Z'))).toBeUndefined();
    expect(codeOf(at('2026-11-04T00:00:00Z'))).toBeUndefined();
    expect(codeOf(at('2026-11-04T01:00:00Z'))).toBe('INVALID_PERIOD');
  });
});
