import {
  DEFAULT_FILTERS,
  filtersFromQuery,
  filtersToQuery,
  sameFilters,
  searchBody,
  type ExploreFilters,
} from './explore-query';

const ATHENS = { lat: 37.98, lng: 23.73 };

describe('filtersFromQuery', () => {
  it('reads every filter', () => {
    expect(
      filtersFromQuery({
        q: ' drill ',
        category: 'tools',
        radius: '10',
        free: '1',
        max: '500',
        unit: 'WEEK',
      }),
    ).toEqual({
      q: 'drill',
      category: 'tools',
      radiusKm: 10,
      freeOnly: true,
      maxPriceCents: 500,
      priceUnit: 'WEEK',
    });
  });

  it('falls back to defaults for anything invalid', () => {
    expect(
      filtersFromQuery({
        category: 'weapons',
        radius: '3',
        free: 'yes',
        max: '5',
        unit: 'YEAR',
      }),
    ).toEqual(DEFAULT_FILTERS);
  });

  it('round-trips through the URL', () => {
    const filters: ExploreFilters = {
      q: 'σκάλα',
      category: 'diy-ladders',
      radiusKm: 2,
      freeOnly: false,
      maxPriceCents: 1500,
      priceUnit: 'DAY',
    };
    const query = Object.fromEntries(
      Object.entries(filtersToQuery(filters)).filter(([, v]) => v !== null),
    );
    expect(filtersFromQuery(query)).toEqual(filters);
  });
});

describe('filtersToQuery', () => {
  it('leaves defaults out of the URL', () => {
    expect(
      Object.values(filtersToQuery(DEFAULT_FILTERS)).every((v) => v === null),
    ).toBe(true);
  });
});

describe('searchBody', () => {
  it('sends only what is set, never a price without its unit', () => {
    expect(searchBody(DEFAULT_FILTERS, ATHENS)).toEqual({
      near: ATHENS,
      radiusKm: 5,
    });
    expect(
      searchBody({ ...DEFAULT_FILTERS, maxPriceCents: 800 }, ATHENS, 'c1'),
    ).toEqual({
      near: ATHENS,
      radiusKm: 5,
      maxPriceCents: 800,
      priceUnit: 'DAY',
      cursor: 'c1',
    });
  });

  it('drops the price limit when only free items are wanted', () => {
    expect(
      searchBody(
        { ...DEFAULT_FILTERS, freeOnly: true, maxPriceCents: 800 },
        ATHENS,
      ),
    ).toEqual({ near: ATHENS, radiusKm: 5, freeOnly: true });
  });
});

describe('sameFilters', () => {
  it('compares every field', () => {
    expect(sameFilters(DEFAULT_FILTERS, { ...DEFAULT_FILTERS })).toBe(true);
    expect(sameFilters(DEFAULT_FILTERS, { ...DEFAULT_FILTERS, q: 'x' })).toBe(
      false,
    );
  });
});
