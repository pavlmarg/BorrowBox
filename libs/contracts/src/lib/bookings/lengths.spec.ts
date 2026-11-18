import type { ItemPricing } from '../catalog/items';
import { bookingLengths, bookingUnit, lengthProblem } from './lengths';

const DAY = 24;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

describe('bookingUnit', () => {
  it.each<[string, ItemPricing, string]>([
    ['free', { free: true }, 'HOUR'],
    ['hourly and daily', { free: false, hourlyCents: 100, dailyCents: 500 }, 'HOUR'],
    ['daily and weekly', { free: false, dailyCents: 500, weeklyCents: 2000 }, 'DAY'],
    ['weekly only', { free: false, weeklyCents: 2000 }, 'WEEK'],
    ['monthly only', { free: false, monthlyCents: 9000 }, 'MONTH'],
  ])('%s → %s', (_, pricing, unit) => {
    expect(bookingUnit(pricing)).toBe(unit);
  });
});

describe('bookingLengths', () => {
  const daily: ItemPricing = { free: false, dailyCents: 500 };

  it('allows any whole hours up to 90 days for an hourly item', () => {
    expect(bookingLengths({ free: false, hourlyCents: 100 }, null, null)).toEqual({
      unit: 'HOUR',
      stepHours: 1,
      minHours: 1,
      maxHours: 90 * DAY,
      bookable: true,
    });
  });

  it('rounds the item’s minimum up and maximum down to whole units', () => {
    expect(bookingLengths(daily, 3, 60)).toMatchObject({
      minHours: DAY,
      maxHours: 2 * DAY,
      bookable: true,
    });
  });

  it('fits whole weeks and months into 90 days', () => {
    expect(bookingLengths({ free: false, weeklyCents: 1 }, null, null).maxHours).toBe(12 * WEEK);
    expect(bookingLengths({ free: false, monthlyCents: 1 }, null, null).maxHours).toBe(3 * MONTH);
  });

  it('is not bookable when no whole unit fits the limits', () => {
    expect(bookingLengths(daily, null, 12).bookable).toBe(false);
    expect(bookingLengths(daily, 25, 47).bookable).toBe(false);
  });
});

describe('lengthProblem', () => {
  const lengths = bookingLengths({ free: false, dailyCents: 500 }, null, 3 * DAY);

  it.each([
    [DAY, null],
    [2 * DAY, null],
    [3 * DAY, null],
    [5, 'notWholeUnits'],
    [DAY + 2, 'notWholeUnits'],
    [4 * DAY, 'tooLong'],
  ])('%i hours → %s', (hours, problem) => {
    expect(lengthProblem(hours, lengths)).toBe(problem);
  });

  it('says tooShort below the minimum', () => {
    const min2 = bookingLengths({ free: false, dailyCents: 500 }, 2 * DAY, null);
    expect(lengthProblem(DAY, min2)).toBe('tooShort');
  });

  it('says notBookable when nothing fits', () => {
    const none = bookingLengths({ free: false, dailyCents: 500 }, null, 12);
    expect(lengthProblem(12, none)).toBe('notBookable');
  });
});
