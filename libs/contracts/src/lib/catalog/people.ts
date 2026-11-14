import type { ItemCategory } from './categories';
import type { ItemPricing, PhotoUrls } from './items';

/**
 * People in Catalog (ADR-0025): the lenders Explore's search bar can find
 * by name, and a lender's items for their public profile and item pages.
 * Only people with at least one ACTIVE item can be found; someone who only
 * rents is never findable by name.
 */

/** Name search returns at most this many people. */
export const PEOPLE_SUGGEST_LIMIT = 5;

/** What has been typed in the search bar. */
export interface SuggestPeopleRequest {
  /** `SUGGEST_MIN_LENGTH` to `SEARCH_QUERY_MAX_LENGTH` characters. */
  q: string;
}

export interface PersonSuggestion {
  id: string;
  displayName: string;
  /** Their profile photo's small size, or null. */
  photoUrl: string | null;
  /** How many ACTIVE items they have. */
  itemCount: number;
}

/**
 * Every typed word must start a word of the name (case and Greek accents
 * ignored). Most items first, then by name. At most `PEOPLE_SUGGEST_LIMIT`.
 */
export interface SuggestPeopleResponse {
  people: PersonSuggestion[];
}

export interface LenderItemsRequest {
  lenderId: string;
}

/** An item card without a distance (no searcher's point here). */
export interface LenderItemSummary {
  id: string;
  title: string;
  category: ItemCategory;
  pricing: ItemPricing;
  depositCents: number;
  coverPhoto: PhotoUrls | null;
}

/**
 * The lender's ACTIVE items, newest first: at most `ITEM_FREE_LIMIT`, so
 * no paging. Empty for unknown and erased accounts (nothing is confirmed).
 */
export interface LenderItemsResponse {
  items: LenderItemSummary[];
}
