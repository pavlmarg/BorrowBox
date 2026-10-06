import type { ItemCategory } from './categories';

/**
 * Shapes shared by Catalog, the gateway and the PWA. Plain types only;
 * validation classes live in the gateway and Catalog.
 *
 * Location privacy (ADR-0007): only `OwnItem` (the owner's view) carries the
 * exact `location`. Public shapes carry `approximateLocation`, the fuzzed
 * point, and never a field that could hold the exact one.
 */

export const ITEM_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'DELETED'] as const;
/**
 * - `DRAFT`: being set up; not searchable.
 * - `ACTIVE`: published; searchable and bookable (Phase 3).
 * - `PAUSED`: hidden by the lender for a while.
 * - `DELETED`: removed; kept as a tombstone because bookings may reference it.
 */
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** WGS 84 degrees. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

// --- Pricing (ADR-0010) -------------------------------------------------------

export const PRICE_UNITS = ['HOUR', 'DAY', 'WEEK', 'MONTH'] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

/**
 * A rate card in integer euro cents. Either `free` with no rates, or at
 * least one rate. A missing rate means that unit isn't offered. What a
 * booking costs (e.g. 9 days = 1 week + 2 days) is computed by Bookings.
 */
export interface ItemPricing {
  free: boolean;
  hourlyCents?: number;
  dailyCents?: number;
  weeklyCents?: number;
  monthlyCents?: number;
}

/** Which `ItemPricing` field holds each unit's rate. */
export const PRICE_FIELD = {
  HOUR: 'hourlyCents',
  DAY: 'dailyCents',
  WEEK: 'weeklyCents',
  MONTH: 'monthlyCents',
} as const satisfies Record<PriceUnit, keyof ItemPricing>;

// --- Photos (ADR-0009) --------------------------------------------------------

export const PHOTO_STATUSES = ['PENDING', 'READY', 'FAILED'] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];

/** Processed versions of a photo (WebP), by width in pixels. */
export const PHOTO_VARIANTS = { small: 320, medium: 800, large: 1600 } as const;
export type PhotoUrls = Record<keyof typeof PHOTO_VARIANTS, string>;

/** A photo as its owner sees it, including ones still being processed. */
export interface PhotoView {
  id: string;
  status: PhotoStatus;
  /** 0-based display order; 0 is the cover. */
  position: number;
  /** Set once `READY`. */
  urls: PhotoUrls | null;
}

/** A processed photo as everyone else sees it. */
export interface PublicPhoto {
  id: string;
  urls: PhotoUrls;
}

// --- Item views -----------------------------------------------------------------

export interface LenderSummary {
  id: string;
  displayName: string;
}

/** The owner's view: everything, including the exact location. */
export interface OwnItem {
  id: string;
  status: ItemStatus;
  title: string;
  description: string;
  category: ItemCategory;
  pricing: ItemPricing;
  depositCents: number;
  /** Exact point, or null until set. Only ever sent to the owner. */
  location: GeoPoint | null;
  /** What everyone else sees (ADR-0007), or null until a location is set. */
  approximateLocation: GeoPoint | null;
  photos: PhotoView[];
  /** ISO-8601. */
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

/** Distance from the searcher to an item's fuzzed point, as a band (ADR-0007). */
export const DISTANCE_BANDS = [
  'UNDER_1_KM',
  '1_2_KM',
  '2_5_KM',
  '5_10_KM',
  'OVER_10_KM',
] as const;
export type DistanceBand = (typeof DISTANCE_BANDS)[number];

/** A search result. */
export interface PublicItemSummary {
  id: string;
  title: string;
  category: ItemCategory;
  pricing: ItemPricing;
  depositCents: number;
  coverPhoto: PhotoUrls | null;
  lender: LenderSummary;
  approximateLocation: GeoPoint;
  distanceBand: DistanceBand;
}

/** The public item page. */
export interface PublicItemDetail {
  id: string;
  title: string;
  description: string;
  category: ItemCategory;
  pricing: ItemPricing;
  depositCents: number;
  /** `READY` photos in display order. */
  photos: PublicPhoto[];
  lender: LenderSummary;
  approximateLocation: GeoPoint;
  publishedAt: string;
}

// --- Search -----------------------------------------------------------------------

export interface SearchItemsRequest {
  /** The searcher's chosen point; used for this query only, never stored or logged. */
  near: GeoPoint;
  radiusKm: SearchRadiusKm;
  /** Free text, matched in Greek and English. */
  q?: string;
  category?: ItemCategory;
  freeOnly?: boolean;
  /** With `priceUnit`: items offering that unit at or below this rate. */
  maxPriceCents?: number;
  priceUnit?: PriceUnit;
  /** Opaque, from the previous page's `nextCursor`. */
  cursor?: string;
  limit?: number;
}

export interface SearchItemsResponse {
  items: PublicItemSummary[];
  /** Null on the last page. */
  nextCursor: string | null;
}

/** Allowed search radii (ADR-0007): fixed steps, so the radius can't be used to probe. */
export const SEARCH_RADIUS_KM = [1, 2, 5, 10, 25, 50] as const;
export type SearchRadiusKm = (typeof SEARCH_RADIUS_KM)[number];
