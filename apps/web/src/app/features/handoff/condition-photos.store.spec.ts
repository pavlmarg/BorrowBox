import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Api } from '../../api/api';
import {
  bookingsControllerAddPhoto,
  bookingsControllerConfirmPhoto,
  bookingsControllerPhotos,
  bookingsControllerRemovePhoto,
} from '../../api/functions';
import type { ConditionPhotoResponse } from '../../api/models';
import { preparePhoto } from '../../shared/photo/photo-prep';
import { ConditionPhotosStore } from './condition-photos.store';

// jsdom has no canvas: the re-encode is tested in photo-prep.spec.
jest.mock('../../shared/photo/photo-prep', () => ({ preparePhoto: jest.fn() }));
const prepare = preparePhoto as jest.MockedFunction<typeof preparePhoto>;

const BOOKING = 'b1';
const photo = (
  over: Partial<ConditionPhotoResponse> = {},
): ConditionPhotoResponse => ({
  id: 'p1',
  phase: 'PICKUP',
  status: 'READY',
  mine: true,
  takenBy: 'LENDER',
  takenAt: '2026-12-01T09:00:00.000Z',
  urls: { thumb: 'https://e.test/t', large: 'https://e.test/l' },
  urlsExpireAt: '2026-12-01T09:05:00.000Z',
  ...over,
});

function setup(invoke: jest.Mock) {
  const put = jest.fn(() => of(null));
  TestBed.configureTestingModule({
    providers: [
      ConditionPhotosStore,
      { provide: Api, useValue: { invoke } },
      { provide: HttpClient, useValue: { put } },
    ],
  });
  return { store: TestBed.inject(ConditionPhotosStore), put };
}

const list = (photos: ConditionPhotoResponse[], PICKUP = true) => ({
  photos,
  canAdd: { PICKUP, RETURN: false },
});

describe('ConditionPhotosStore', () => {
  afterEach(() => {
    jest.useRealTimers();
    prepare.mockReset();
  });

  it('loads the photos and whether the caller can add', async () => {
    const invoke = jest.fn().mockResolvedValue(list([photo()]));
    const { store } = setup(invoke);

    await store.load(BOOKING);

    expect(invoke).toHaveBeenCalledWith(bookingsControllerPhotos, {
      bookingId: BOOKING,
    });
    expect(store.photos()).toHaveLength(1);
    expect(store.canAdd()).toEqual({ PICKUP: true, RETURN: false });
    expect(store.status()).toBe('ready');
  });

  it('uploads straight to storage, confirms, then waits until ready', async () => {
    jest.useFakeTimers();
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    prepare.mockResolvedValue({ ok: true, blob, contentType: 'image/jpeg' });
    let lists = 0;
    let id = '';
    const invoke = jest.fn(
      async (fn: unknown, params: { body?: { photoId: string } }) => {
        if (fn === bookingsControllerAddPhoto) {
          id = params.body!.photoId;
          return {
            uploadUrl: 'https://s3.test/incoming/x',
            uploadHeaders: { 'Content-Type': 'image/jpeg' },
            photo: photo({ id, status: 'PENDING' }),
          };
        }
        if (fn === bookingsControllerConfirmPhoto) {
          return photo({ id, status: 'PENDING' });
        }
        // Processed on the second reload.
        lists++;
        return list([photo({ id, status: lists < 2 ? 'PENDING' : 'READY' })]);
      },
    );
    const { store, put } = setup(invoke);

    const done = store.add(BOOKING, 'PICKUP', new File(['x'], 'a.jpg'));
    await jest.advanceTimersByTimeAsync(5_000);
    await done;

    const added = invoke.mock.calls.find(
      ([fn]) => fn === bookingsControllerAddPhoto,
    )!;
    expect(added[1]).toMatchObject({
      bookingId: BOOKING,
      body: { phase: 'PICKUP', contentType: 'image/jpeg', sizeBytes: 1 },
    });
    expect(put).toHaveBeenCalledWith(
      'https://s3.test/incoming/x',
      blob,
      expect.anything(),
    );
    expect(store.photos()[0].status).toBe('READY');
    expect(store.problem()).toBeNull();
    expect(store.adding()).toBeNull();
  });

  it('reports a file the browser refused without calling the server', async () => {
    prepare.mockResolvedValue({ ok: false, problem: 'tooSmall' });
    const invoke = jest.fn();
    const { store } = setup(invoke);

    await store.add(BOOKING, 'PICKUP', new File(['x'], 'a.jpg'));

    expect(store.problem()).toBe('tooSmall');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports the limit the server refused with', async () => {
    prepare.mockResolvedValue({
      ok: true,
      blob: new Blob(['x']),
      contentType: 'image/jpeg',
    });
    const invoke = jest.fn().mockRejectedValue(
      new HttpErrorResponse({
        status: 409,
        error: { code: 'PHOTO_LIMIT_REACHED' },
      }),
    );
    const { store } = setup(invoke);

    await store.add(BOOKING, 'PICKUP', new File(['x'], 'a.jpg'));

    expect(store.problem()).toBe('PHOTO_LIMIT_REACHED');
  });

  it('removes a photo from the list once the server did', async () => {
    const invoke = jest.fn().mockResolvedValueOnce(list([photo()]));
    const { store } = setup(invoke);
    await store.load(BOOKING);
    invoke.mockResolvedValueOnce(undefined);

    await store.remove(BOOKING, 'p1');

    expect(invoke).toHaveBeenLastCalledWith(bookingsControllerRemovePhoto, {
      bookingId: BOOKING,
      photoId: 'p1',
    });
    expect(store.photos()).toEqual([]);
  });

  it('fetches fresh links only when the shown ones are about to expire', async () => {
    const invoke = jest.fn().mockResolvedValue(list([photo()]));
    const { store } = setup(invoke);
    await store.load(BOOKING);

    await store.refreshLinks(BOOKING, new Date('2026-12-01T09:00:00Z'));
    expect(invoke).toHaveBeenCalledTimes(1);

    await store.refreshLinks(BOOKING, new Date('2026-12-01T09:04:45Z'));
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
