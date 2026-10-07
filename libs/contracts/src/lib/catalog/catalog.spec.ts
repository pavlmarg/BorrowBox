import { UserProfileUpdatedV1 } from '../identity/events';
import { ITEM_CATEGORIES, isItemCategory } from './categories';
import { ItemCreatedV1, ItemDeletedV1, ItemUpdatedV1 } from './events';
import {
  DISTANCE_BANDS,
  ITEM_STATUSES,
  PRICE_FIELD,
  PRICE_UNITS,
  SEARCH_RADIUS_KM,
  type ItemPricing,
  type PublicItemDetail,
  type PublicItemSummary,
} from './items';
import { CatalogRpc, type CatalogRpcPattern } from './rpc';
import {
  DEPOSIT_MAX_CENTS,
  DEPOSIT_MIN_CENTS,
  ITEM_FREE_LIMIT,
  ITEM_PHOTOS_MAX,
  ITEM_PHOTOS_MIN_TO_PUBLISH,
  ITEM_TITLE_MAX_LENGTH,
  ITEM_TITLE_MIN_LENGTH,
  RATE_MAX_CENTS,
  RATE_MIN_CENTS,
  SEARCH_PAGE_SIZE_DEFAULT,
  SEARCH_PAGE_SIZE_MAX,
  isCentsInRange,
  isValidPricing,
} from './validation';

// --- Compile-time leak guard (ADR-0007) ----------------------------------------
// Public shapes must have no field that could carry the exact location. If
// someone adds one, this file stops compiling and the test run fails.
type Expect<T extends true> = T;
type HasNoExactLocation<T> = 'location' extends keyof T ? false : true;
export type PublicShapesHaveNoExactLocation = [
  Expect<HasNoExactLocation<PublicItemSummary>>,
  Expect<HasNoExactLocation<PublicItemDetail>>,
  Expect<HasNoExactLocation<PublicItemSummary['lender']>>,
  Expect<HasNoExactLocation<PublicItemDetail['lender']>>,
];

describe('categories', () => {
  it('are unique lower-case slugs', () => {
    expect(new Set(ITEM_CATEGORIES).size).toBe(ITEM_CATEGORIES.length);
    for (const c of ITEM_CATEGORIES) expect(c).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('are recognised by isItemCategory', () => {
    expect(isItemCategory('tools')).toBe(true);
    expect(isItemCategory('weapons')).toBe(false);
    expect(isItemCategory(undefined)).toBe(false);
  });
});

describe('catalog limits', () => {
  it('are consistent', () => {
    expect(ITEM_TITLE_MIN_LENGTH).toBeLessThanOrEqual(ITEM_TITLE_MAX_LENGTH);
    expect(RATE_MIN_CENTS).toBeGreaterThan(0);
    expect(RATE_MIN_CENTS).toBeLessThanOrEqual(RATE_MAX_CENTS);
    expect(DEPOSIT_MIN_CENTS).toBeLessThanOrEqual(DEPOSIT_MAX_CENTS);
    expect(ITEM_PHOTOS_MIN_TO_PUBLISH).toBeLessThanOrEqual(ITEM_PHOTOS_MAX);
    expect(Number.isInteger(ITEM_FREE_LIMIT)).toBe(true);
    expect(ITEM_FREE_LIMIT).toBeGreaterThan(0);
    expect(SEARCH_PAGE_SIZE_DEFAULT).toBeLessThanOrEqual(SEARCH_PAGE_SIZE_MAX);
    expect([...SEARCH_RADIUS_KM]).toEqual(
      [...SEARCH_RADIUS_KM].sort((a, b) => a - b),
    );
  });

  it('name every status, unit and distance band once', () => {
    for (const list of [ITEM_STATUSES, PRICE_UNITS, DISTANCE_BANDS]) {
      expect(new Set(list).size).toBe(list.length);
    }
    expect(Object.keys(PRICE_FIELD).sort()).toEqual([...PRICE_UNITS].sort());
  });
});

describe('isCentsInRange', () => {
  it.each([
    [10, true],
    [100_000, true],
    [9, false],
    [100_001, false],
    [10.5, false],
    [Number.NaN, false],
    ['50', false],
  ])('%p → %p', (cents, ok) =>
    expect(isCentsInRange(cents, RATE_MIN_CENTS, RATE_MAX_CENTS)).toBe(ok),
  );
});

describe('isValidPricing', () => {
  it.each<[string, ItemPricing]>([
    ['free with no rates', { free: true }],
    ['10 cents per hour', { free: false, hourlyCents: 10 }],
    ['one monthly rate', { free: false, monthlyCents: 4000 }],
    [
      'every unit',
      {
        free: false,
        hourlyCents: 50,
        dailyCents: 300,
        weeklyCents: 1500,
        monthlyCents: 4000,
      },
    ],
  ])('accepts %s', (_, pricing) => expect(isValidPricing(pricing)).toBe(true));

  it.each<[string, ItemPricing]>([
    ['not free and no rates', { free: false }],
    ['free but with a rate', { free: true, dailyCents: 300 }],
    ['a rate below 10 cents', { free: false, hourlyCents: 9 }],
    ['a zero rate', { free: false, dailyCents: 0 }],
    ['a rate above €1,000', { free: false, monthlyCents: 100_001 }],
    ['fractional cents', { free: false, dailyCents: 299.5 }],
    [
      'one bad rate among good ones',
      { free: false, dailyCents: 300, weeklyCents: -1 },
    ],
  ])('rejects %s', (_, pricing) => expect(isValidPricing(pricing)).toBe(false));
});

describe('catalog events', () => {
  it('use versioned routing keys', () => {
    expect(ItemCreatedV1.routingKey).toBe('item.created.v1');
    expect(ItemUpdatedV1.routingKey).toBe('item.updated.v1');
    expect(ItemDeletedV1.routingKey).toBe('item.deleted.v1');
    expect(UserProfileUpdatedV1.routingKey).toBe('user.profile_updated.v1');
  });
});

describe('CatalogRpc patterns', () => {
  const patterns = Object.values(CatalogRpc);

  it('are unique and namespaced to catalog', () => {
    expect(new Set(patterns).size).toBe(patterns.length);
    for (const p of patterns) expect(p).toMatch(/^catalog\.[a-z.]+$/);
  });

  it('each have a contract entry', () => {
    // Compile-time check: every pattern is a key of CatalogRpcContract.
    const typed: CatalogRpcPattern[] = patterns;
    expect(typed).toHaveLength(16);
  });
});
