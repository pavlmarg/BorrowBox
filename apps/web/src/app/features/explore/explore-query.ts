import type { Params } from '@angular/router';
import {
  PRICE_UNITS,
  RATE_MAX_CENTS,
  RATE_MIN_CENTS,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_RADIUS_KM,
  isItemCategory,
  type GeoPoint,
  type ItemCategory,
  type PriceUnit,
  type SearchRadiusKm,
} from '@borrowbox/contracts';
import type { CategoryCountsBody, SearchItemsBody } from '../../api/models';

/** What the searcher chose, apart from the point (which never leaves memory). */
export interface ExploreFilters {
  q: string;
  category: ItemCategory | null;
  radiusKm: SearchRadiusKm;
  freeOnly: boolean;
  /** With `priceUnit`; null for no price limit. */
  maxPriceCents: number | null;
  priceUnit: PriceUnit;
}

export const DEFAULT_FILTERS: ExploreFilters = {
  q: '',
  category: null,
  radiusKm: 5,
  freeOnly: false,
  maxPriceCents: null,
  priceUnit: 'DAY',
};

/**
 * Filters from the URL (`?q=drill&category=tools&radius=10&free=1&max=500&unit=DAY`),
 * so a search can be shared. Anything invalid falls back to its default.
 * The searcher's point is deliberately not part of it (D4).
 */
export function filtersFromQuery(params: Params): ExploreFilters {
  const text = (key: string) =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined;

  const q = (text('q') ?? '').trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
  const category = text('category');
  const radius = Number(text('radius'));
  const max = Number(text('max'));
  const unit = text('unit');

  return {
    q,
    category: isItemCategory(category) ? category : null,
    radiusKm: (SEARCH_RADIUS_KM as readonly number[]).includes(radius)
      ? (radius as SearchRadiusKm)
      : DEFAULT_FILTERS.radiusKm,
    freeOnly: text('free') === '1',
    maxPriceCents:
      Number.isInteger(max) && max >= RATE_MIN_CENTS && max <= RATE_MAX_CENTS
        ? max
        : null,
    priceUnit: (PRICE_UNITS as readonly string[]).includes(unit ?? '')
      ? (unit as PriceUnit)
      : DEFAULT_FILTERS.priceUnit,
  };
}

/**
 * The URL's query params for these filters: defaults are left out, and
 * null removes a param when merged by the router.
 */
export function filtersToQuery(f: ExploreFilters): Params {
  return {
    q: f.q || null,
    category: f.category,
    radius: f.radiusKm === DEFAULT_FILTERS.radiusKm ? null : String(f.radiusKm),
    free: f.freeOnly ? '1' : null,
    max: f.maxPriceCents === null ? null : String(f.maxPriceCents),
    unit: f.maxPriceCents === null ? null : f.priceUnit,
  };
}

export function sameFilters(a: ExploreFilters, b: ExploreFilters): boolean {
  return (Object.keys(a) as Array<keyof ExploreFilters>).every(
    (key) => a[key] === b[key],
  );
}

/** The search request; the price limit is only sent with its unit. */
/** The search's filters apart from the category, for the category counts. */
export function countsBody(
  f: ExploreFilters,
  near: GeoPoint,
): CategoryCountsBody {
  return searchBody({ ...f, category: null }, near);
}

export function searchBody(
  f: ExploreFilters,
  near: GeoPoint,
  cursor: string | null = null,
): SearchItemsBody {
  return {
    near,
    radiusKm: f.radiusKm,
    ...(f.q ? { q: f.q } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.freeOnly ? { freeOnly: true } : {}),
    ...(f.maxPriceCents !== null && !f.freeOnly
      ? { maxPriceCents: f.maxPriceCents, priceUnit: f.priceUnit }
      : {}),
    ...(cursor ? { cursor } : {}),
  };
}
