import {
  PRICE_FIELD,
  PRICE_UNITS,
  type ItemPricing,
  type PriceUnit,
} from '@borrowbox/contracts';

export interface Rate {
  unit: PriceUnit;
  cents: number;
}

/** Every rate the item offers, shortest unit first (ADR-0010). */
export function offeredRates(pricing: ItemPricing): Rate[] {
  if (pricing.free) return [];
  return PRICE_UNITS.flatMap((unit) => {
    const cents = pricing[PRICE_FIELD[unit]];
    return cents === undefined ? [] : [{ unit, cents }];
  });
}

/** What a result card shows: "Free", or one rate and how many others exist. */
export type CardRate =
  { free: true } | { free: false; rate: Rate; moreRates: number };

/**
 * The daily rate if offered (it compares best across items), else the
 * shortest unit offered.
 */
export function cardRate(pricing: ItemPricing): CardRate {
  const rates = offeredRates(pricing);
  if (pricing.free || rates.length === 0) return { free: true };
  const rate = rates.find((r) => r.unit === 'DAY') ?? rates[0];
  return { free: false, rate, moreRates: rates.length - 1 };
}
