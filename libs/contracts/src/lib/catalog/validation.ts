/**
 * Input rules shared by the PWA (forms), the gateway (HTTP DTOs) and Catalog
 * (RPC DTOs), so all three agree. Money is integer euro cents.
 */
import { PRICE_FIELD, PRICE_UNITS, type ItemPricing } from './items';

export const ITEM_TITLE_MIN_LENGTH = 3;
export const ITEM_TITLE_MAX_LENGTH = 80;
export const ITEM_DESCRIPTION_MAX_LENGTH = 2000;

/** Each offered rate (per hour, day, week or month): €0.10 – €1,000. */
export const RATE_MIN_CENTS = 10;
export const RATE_MAX_CENTS = 100_000;

/** €0 – €5,000. Free items may still ask for a deposit. */
export const DEPOSIT_MIN_CENTS = 0;
export const DEPOSIT_MAX_CENTS = 500_000;

/** A published item needs at least one processed photo (ADR-0009). */
export const ITEM_PHOTOS_MIN_TO_PUBLISH = 1;
export const ITEM_PHOTOS_MAX = 10;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];

export const SEARCH_QUERY_MAX_LENGTH = 100;
export const SEARCH_PAGE_SIZE_DEFAULT = 20;
export const SEARCH_PAGE_SIZE_MAX = 50;

/** True if `cents` is a whole number of cents within [min, max]. */
export function isCentsInRange(
  cents: unknown,
  min: number,
  max: number,
): cents is number {
  return (
    typeof cents === 'number' &&
    Number.isInteger(cents) &&
    cents >= min &&
    cents <= max
  );
}

/**
 * Either free with no rates, or not free with at least one rate, each
 * within [RATE_MIN_CENTS, RATE_MAX_CENTS].
 */
export function isValidPricing(pricing: ItemPricing): boolean {
  const rates = PRICE_UNITS.map((unit) => pricing[PRICE_FIELD[unit]]).filter(
    (rate) => rate !== undefined,
  );
  if (pricing.free) return rates.length === 0;
  return (
    rates.length > 0 &&
    rates.every((rate) => isCentsInRange(rate, RATE_MIN_CENTS, RATE_MAX_CENTS))
  );
}
