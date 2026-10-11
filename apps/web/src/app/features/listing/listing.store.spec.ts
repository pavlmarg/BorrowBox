import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { OwnItemResponse } from '../../api/models';
import { tick } from '../../../testing/auth';
import { ListingStore } from './listing.store';

const own = (overrides: Partial<OwnItemResponse> = {}): OwnItemResponse => ({
  id: 'i-1',
  status: 'DRAFT',
  title: 'Drill',
  description: '',
  category: 'tools',
  pricing: { free: false, dailyCents: 800 },
  depositCents: 0,
  location: null,
  approximateLocation: null,
  photos: [],
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  publishedAt: null,
  ...overrides,
});

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), ListingStore],
  });
  return {
    store: TestBed.inject(ListingStore),
    http: TestBed.inject(HttpTestingController),
  };
}

const createBody = (itemId: string) => ({
  itemId,
  title: 'Drill',
  category: 'tools' as const,
  pricing: { free: false, dailyCents: 800 },
  depositCents: 0,
});

describe('ListingStore', () => {
  it('creates the draft with the id it chose, then only updates', async () => {
    const { store, http } = setup();
    store.startNew();
    const id = store.itemId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const created = store.saveDetails(
      () => createBody(id),
      () => null,
    );
    const post = http.expectOne({ method: 'POST', url: '/api/me/items' });
    expect(post.request.body.itemId).toBe(id);
    post.flush(own({ id }));
    expect(await created).toBe(true);

    // Nothing changed: no request at all.
    expect(
      await store.saveDetails(
        () => createBody(id),
        () => null,
      ),
    ).toBe(true);
    http.expectNone({ method: 'PATCH' });

    const updated = store.saveDetails(
      () => createBody(id),
      () => ({ title: 'Bosch drill' }),
    );
    const patch = http.expectOne({
      method: 'PATCH',
      url: `/api/me/items/${id}`,
    });
    expect(patch.request.body).toEqual({ title: 'Bosch drill' });
    patch.flush(own({ id, title: 'Bosch drill' }));
    await updated;
    expect(store.item()?.title).toBe('Bosch drill');
  });

  it('keeps the error for the screen when a save fails', async () => {
    const { store, http } = setup();
    store.startNew();
    const saving = store.saveDetails(
      () => createBody(store.itemId()),
      () => null,
    );
    http
      .expectOne('/api/me/items')
      .flush(
        { statusCode: 409, code: 'ITEM_LIMIT_REACHED', message: 'limit' },
        { status: 409, statusText: 'Conflict' },
      );
    expect(await saving).toBe(false);
    expect(store.error()).toBe('ITEM_LIMIT_REACHED');
    expect(store.saving()).toBe(false);
  });

  it('adds photos only up to the limit, and starts uploading', async () => {
    const { store, http } = setup();
    const loading = store.load('i-1');
    http.expectOne('/api/me/items/i-1').flush(
      own({
        photos: Array.from({ length: 8 }, (_, i) => ({
          id: `p-${i}`,
          position: i,
          status: 'READY' as const,
          urls: { small: 's', medium: 'm', large: 'l' },
        })),
      }),
    );
    await loading;
    expect(store.photoSlotsLeft()).toBe(2);

    const files = ['a', 'b', 'c'].map(
      (name) => new File(['x'], `${name}.tiff`, { type: 'image/tiff' }),
    );
    // jsdom can't decode images, so these go up as they are (ADR-0013).
    expect(store.addPhotos(files)).toBe(1);
    expect(store.uploads().map((u) => u.name)).toEqual(['a.tiff', 'b.tiff']);

    await tick();
    const requests = http.match({
      method: 'POST',
      url: '/api/me/items/i-1/photos',
    });
    expect(requests.map((r) => r.request.body)).toEqual([
      { contentType: 'image/tiff', sizeBytes: 1 },
      { contentType: 'image/tiff', sizeBytes: 1 },
    ]);
  });
});
