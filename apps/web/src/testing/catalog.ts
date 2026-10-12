// Test-only helpers (excluded from the app build).
import type { PublicItemSummaryResponse } from '../app/api/models';

/** A search result as the gateway returns it. */
export function publicItem(
  id: string,
  overrides: Partial<PublicItemSummaryResponse> = {},
): PublicItemSummaryResponse {
  return {
    id,
    title: `Item ${id}`,
    descriptionExcerpt: 'Works well',
    category: 'tools',
    pricing: { free: false, dailyCents: 500 },
    depositCents: 0,
    coverPhoto: null,
    lender: { id: 'l-1', displayName: 'Lena' },
    approximateLocation: { lat: 37.98, lng: 23.73 },
    distanceBand: 'UNDER_1_KM',
    ...overrides,
  };
}
