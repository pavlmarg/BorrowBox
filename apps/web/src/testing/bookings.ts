// Test-only helpers (excluded from the app build).
import type { BookingViewResponse } from '../app/api/models';

/** A paid-for booking as its renter sees it; override what a test needs. */
export function booking(
  overrides: Partial<BookingViewResponse> = {},
): BookingViewResponse {
  return {
    id: 'b-1',
    role: 'RENTER',
    itemId: 'i-1',
    itemTitle: 'Bosch drill',
    renter: { userId: 'u-1', displayName: 'Ana' },
    lender: { userId: 'lender-1', displayName: 'Eleni' },
    start: '2026-11-20T08:00:00.000Z',
    end: '2026-11-21T08:00:00.000Z',
    status: 'REQUESTED',
    price: {
      rentCents: 2000,
      depositCents: 5000,
      feeCents: 200,
      totalCents: 7200,
      lenderFeeCents: 150,
      payoutCents: 1850,
      units: { HOUR: 0, DAY: 1, WEEK: 0, MONTH: 0 },
      offerId: null,
    },
    pricing: { free: false, dailyCents: 2000 },
    reason: null,
    expiresAt: '2026-11-10T10:00:00.000Z',
    payBy: null,
    createdAt: '2026-11-09T10:00:00.000Z',
    updatedAt: '2026-11-09T10:00:00.000Z',
    ...overrides,
  };
}
