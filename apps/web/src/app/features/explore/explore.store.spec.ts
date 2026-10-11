import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { tick } from '../../../testing/auth';
import { publicItem } from '../../../testing/catalog';
import { DEFAULT_FILTERS } from './explore-query';
import { ExploreStore } from './explore.store';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    store: TestBed.inject(ExploreStore),
    http: TestBed.inject(HttpTestingController),
  };
}

const SEARCH = { method: 'POST', url: '/api/items/search' };
const answer = (req: TestRequest, ids: string[], nextCursor: string | null) =>
  req.flush({ items: ids.map((id) => publicItem(id)), nextCursor });

describe('ExploreStore', () => {
  it('searches around central Athens with the URL’s filters', async () => {
    const { store, http } = setup();
    const done = store.start({ ...DEFAULT_FILTERS, q: 'drill' });
    const req = http.expectOne(SEARCH);
    expect(req.request.body).toEqual({
      near: { lat: 37.9838, lng: 23.7275 },
      radiusKm: 5,
      q: 'drill',
    });
    expect(store.status()).toBe('loading');
    answer(req, ['a', 'b'], 'next-1');
    await done;

    expect(store.status()).toBe('ready');
    expect(store.items().map((i) => i.id)).toEqual(['a', 'b']);
    expect(store.hasMore()).toBe(true);
  });

  it('appends the next page', async () => {
    const { store, http } = setup();
    const first = store.start(DEFAULT_FILTERS);
    answer(http.expectOne(SEARCH), ['a'], 'next-1');
    await first;

    const more = store.loadMore();
    const req = http.expectOne(SEARCH);
    expect(req.request.body.cursor).toBe('next-1');
    answer(req, ['b'], null);
    await more;

    expect(store.items().map((i) => i.id)).toEqual(['a', 'b']);
    expect(store.hasMore()).toBe(false);
  });

  it('starts over when a filter changes', async () => {
    const { store, http } = setup();
    const first = store.start(DEFAULT_FILTERS);
    answer(http.expectOne(SEARCH), ['a'], 'next-1');
    await first;

    const again = store.setFilters({ category: 'garden' });
    expect(store.items()).toEqual([]);
    const req = http.expectOne(SEARCH);
    expect(req.request.body).toEqual(
      expect.objectContaining({ category: 'garden' }),
    );
    expect(req.request.body.cursor).toBeUndefined();
    answer(req, ['g'], null);
    await again;
    expect(store.items().map((i) => i.id)).toEqual(['g']);
  });

  it('ignores an older answer that arrives after a newer one', async () => {
    const { store, http } = setup();
    void store.start(DEFAULT_FILTERS);
    const older = http.expectOne(SEARCH);
    void store.setFilters({ q: 'ladder' });
    const newer = http.match(SEARCH).at(-1) as TestRequest;

    answer(newer, ['new'], null);
    await tick();
    answer(older, ['old'], null);
    await tick();

    expect(store.items().map((i) => i.id)).toEqual(['new']);
  });

  it('keeps the results when coming back with the same filters', async () => {
    const { store, http } = setup();
    const first = store.start(DEFAULT_FILTERS);
    answer(http.expectOne(SEARCH), ['a'], null);
    await first;
    store.saveScroll(240);

    await store.start({ ...DEFAULT_FILTERS });
    http.expectNone(SEARCH);
    expect(store.items().map((i) => i.id)).toEqual(['a']);
    expect(store.scrollTop()).toBe(240);
  });

  it('searches the new area', async () => {
    const { store, http } = setup();
    const done = store.setArea({ lat: 40.64, lng: 22.94 });
    const req = http.expectOne(SEARCH);
    expect(req.request.body.near).toEqual({ lat: 40.64, lng: 22.94 });
    answer(req, [], null);
    await done;
    expect(store.isEmpty()).toBe(true);
  });

  it('searches a new area with its radius in one request', async () => {
    const { store, http } = setup();
    const done = store.searchArea({ lat: 38, lng: 23.8 }, 2);
    const req = http.expectOne(SEARCH);
    expect(req.request.body).toEqual(
      expect.objectContaining({ near: { lat: 38, lng: 23.8 }, radiusKm: 2 }),
    );
    answer(req, [], null);
    await done;
    expect(store.filters().radiusKm).toBe(2);
    http.verify();
  });

  it('reports a failed search', async () => {
    const { store, http } = setup();
    const done = store.start(DEFAULT_FILTERS);
    http.expectOne(SEARCH).flush(
      {
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable, try again later',
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await done;
    expect(store.status()).toBe('error');
    expect(store.error()).toBe('SERVICE_UNAVAILABLE');
  });
});
