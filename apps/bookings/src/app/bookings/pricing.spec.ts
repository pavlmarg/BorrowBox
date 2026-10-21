import type { ItemPricing, PriceUnits } from '@borrowbox/contracts';
import { rentFor, UNIT_HOURS } from './pricing';

const units = (partial: Partial<PriceUnits>): PriceUnits => ({
  HOUR: 0,
  DAY: 0,
  WEEK: 0,
  MONTH: 0,
  ...partial,
});

describe('rentFor', () => {
  it('charges a free item nothing', () => {
    expect(rentFor({ free: true }, 50)).toEqual({
      rentCents: 0,
      units: units({}),
    });
  });

  it('charges whole hours at the hourly rate', () => {
    expect(rentFor({ free: false, hourlyCents: 300 }, 5)).toEqual({
      rentCents: 1500,
      units: units({ HOUR: 5 }),
    });
  });

  it('rounds up to whole units when only longer units are offered', () => {
    // 25 hours with only a daily rate: two days.
    expect(rentFor({ free: false, dailyCents: 1000 }, 25)).toEqual({
      rentCents: 2000,
      units: units({ DAY: 2 }),
    });
  });

  it('mixes units: 9 days = 1 week + 2 days', () => {
    expect(
      rentFor({ free: false, dailyCents: 500, weeklyCents: 2500 }, 9 * 24),
    ).toEqual({ rentCents: 3500, units: units({ WEEK: 1, DAY: 2 }) });
  });

  it('covers more than the period when a longer unit is cheaper (ADR-0015)', () => {
    // 6 days at €5 = €30, a week is €25.
    expect(
      rentFor({ free: false, dailyCents: 500, weeklyCents: 2500 }, 6 * 24),
    ).toEqual({ rentCents: 2500, units: units({ WEEK: 1 }) });
  });

  it('caps hours with a day once a day is cheaper', () => {
    // 10 hours at €1 = €10 > a €8 day.
    expect(
      rentFor({ free: false, hourlyCents: 100, dailyCents: 800 }, 10),
    ).toEqual({ rentCents: 800, units: units({ DAY: 1 }) });
    // 7 hours at €1 = €7 < €8.
    expect(
      rentFor({ free: false, hourlyCents: 100, dailyCents: 800 }, 7),
    ).toEqual({ rentCents: 700, units: units({ HOUR: 7 }) });
  });

  it('uses months for long periods: 90 days = 3 months', () => {
    expect(
      rentFor(
        { free: false, dailyCents: 500, weeklyCents: 3000, monthlyCents: 9000 },
        90 * 24,
      ),
    ).toEqual({ rentCents: 27000, units: units({ MONTH: 3 }) });
  });

  it('prefers the exact cover when a longer unit costs the same', () => {
    // 6 days at €5 = €30 = a €30 week: keep the 6 days.
    expect(
      rentFor({ free: false, dailyCents: 500, weeklyCents: 3000 }, 6 * 24),
    ).toEqual({ rentCents: 3000, units: units({ DAY: 6 }) });
  });

  it('prefers fewer units at the same price and cover', () => {
    // A day at €24 = 24 hours at €1: one day.
    expect(
      rentFor({ free: false, hourlyCents: 100, dailyCents: 2400 }, 24),
    ).toEqual({ rentCents: 2400, units: units({ DAY: 1 }) });
  });

  it('handles the longest booking with only hourly rates', () => {
    expect(rentFor({ free: false, hourlyCents: 100_000 }, 2160)).toEqual({
      rentCents: 216_000_000,
      units: units({ HOUR: 2160 }),
    });
  });

  it.each([0, -1, 1.5])('rejects %p hours', (hours) => {
    expect(() => rentFor({ free: false, hourlyCents: 100 }, hours)).toThrow();
  });

  it('rejects a rate card that offers nothing', () => {
    expect(() => rentFor({ free: false }, 3)).toThrow();
  });

  it('matches a brute-force search on random rate cards', () => {
    // Deterministic pseudo-random rate cards (no flaky seeds).
    let seed = 42;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % max;
    };
    for (let run = 0; run < 200; run++) {
      const pricing: ItemPricing = { free: false };
      if (next(2)) pricing.hourlyCents = 10 + next(500);
      if (next(2)) pricing.dailyCents = 10 + next(5000);
      if (next(2)) pricing.weeklyCents = 10 + next(20000);
      if (next(2)) pricing.monthlyCents = 10 + next(60000);
      if (Object.keys(pricing).length === 1) pricing.dailyCents = 700;
      const hours = 1 + next(24 * 40);

      const result = rentFor(pricing, hours);
      expect(result.rentCents).toBe(bruteForceCost(pricing, hours));
      const covered =
        result.units.HOUR * UNIT_HOURS.HOUR +
        result.units.DAY * UNIT_HOURS.DAY +
        result.units.WEEK * UNIT_HOURS.WEEK +
        result.units.MONTH * UNIT_HOURS.MONTH;
      expect(covered).toBeGreaterThanOrEqual(hours);
      expect(
        result.units.HOUR * (pricing.hourlyCents ?? 0) +
          result.units.DAY * (pricing.dailyCents ?? 0) +
          result.units.WEEK * (pricing.weeklyCents ?? 0) +
          result.units.MONTH * (pricing.monthlyCents ?? 0),
      ).toBe(result.rentCents);
    }
  });
});

/** Tries every count of months, weeks and days; hours fill the rest. */
function bruteForceCost(pricing: ItemPricing, hours: number): number {
  let best = Infinity;
  const options = (rate: number | undefined, size: number) =>
    rate === undefined ? [0] : range(Math.ceil(hours / size) + 1);
  for (const m of options(pricing.monthlyCents, UNIT_HOURS.MONTH)) {
    for (const w of options(pricing.weeklyCents, UNIT_HOURS.WEEK)) {
      for (const d of options(pricing.dailyCents, UNIT_HOURS.DAY)) {
        const covered =
          m * UNIT_HOURS.MONTH + w * UNIT_HOURS.WEEK + d * UNIT_HOURS.DAY;
        const rest = Math.max(0, hours - covered);
        if (rest > 0 && pricing.hourlyCents === undefined) continue;
        const cost =
          m * (pricing.monthlyCents ?? 0) +
          w * (pricing.weeklyCents ?? 0) +
          d * (pricing.dailyCents ?? 0) +
          rest * (pricing.hourlyCents ?? 0);
        best = Math.min(best, cost);
      }
    }
  }
  return best;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}
