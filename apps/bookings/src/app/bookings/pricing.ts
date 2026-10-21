import {
  PRICE_FIELD,
  PRICE_UNITS,
  type ItemPricing,
  type PriceUnit,
  type PriceUnits,
} from '@borrowbox/contracts';

/** A day is 24 hours, a week 7 days, a month 30 days (ADR-0015). */
export const UNIT_HOURS: Record<PriceUnit, number> = {
  HOUR: 1,
  DAY: 24,
  WEEK: 7 * 24,
  MONTH: 30 * 24,
};

export interface Rent {
  rentCents: number;
  units: PriceUnits;
}

interface Best {
  cost: number;
  /** Hours the units cover (≥ the hours asked for). */
  covered: number;
  count: number;
  /** The unit added last; follow `from` back to rebuild the rest. */
  unit: PriceUnit | null;
  from: number;
}

/**
 * The rent for `hours` whole hours (ADR-0015): the cheapest combination of
 * the offered units that covers at least the period. It may cover more when
 * that's cheaper (6 days at €5 vs a €25 week). Among equally cheap
 * combinations it picks the one covering the fewest hours, then the one
 * with the fewest units, so the result never depends on iteration order.
 *
 * A free item's rent is 0. Throws if the rate card offers nothing, which
 * Catalog's validation never lets through.
 */
export function rentFor(pricing: ItemPricing, hours: number): Rent {
  if (!Number.isInteger(hours) || hours < 1) {
    throw new Error('hours must be a positive integer');
  }
  const none = zeroUnits();
  if (pricing.free) return { rentCents: 0, units: none };

  const offered = PRICE_UNITS.flatMap((unit) => {
    const rate = pricing[PRICE_FIELD[unit]];
    return rate === undefined ? [] : [{ unit, rate, size: UNIT_HOURS[unit] }];
  });
  if (offered.length === 0) throw new Error('The rate card offers no unit');

  // best[h]: the cheapest units covering at least h hours. Dropping any one
  // unit from an optimal set leaves an optimal cover of the rest, so each
  // entry builds on a smaller one.
  const best: Best[] = [{ cost: 0, covered: 0, count: 0, unit: null, from: 0 }];
  for (let h = 1; h <= hours; h++) {
    let pick: Best | null = null;
    for (const { unit, rate, size } of offered) {
      const from = Math.max(0, h - size);
      const prev = best[from];
      const candidate: Best = {
        cost: prev.cost + rate,
        covered: prev.covered + size,
        count: prev.count + 1,
        unit,
        from,
      };
      if (pick === null || isBetter(candidate, pick)) pick = candidate;
    }
    best.push(pick as Best);
  }

  const units = zeroUnits();
  for (let h = hours; best[h].unit !== null; h = best[h].from) {
    units[best[h].unit as PriceUnit]++;
  }
  return { rentCents: best[hours].cost, units };
}

function isBetter(a: Best, b: Best): boolean {
  if (a.cost !== b.cost) return a.cost < b.cost;
  if (a.covered !== b.covered) return a.covered < b.covered;
  return a.count < b.count;
}

function zeroUnits(): PriceUnits {
  return { HOUR: 0, DAY: 0, WEEK: 0, MONTH: 0 };
}
