import {
  HttpClient,
  HttpEventType,
  HttpHeaders,
  HttpRequest,
} from '@angular/common/http';
import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { ITEM_PHOTOS_MAX, type GeoPoint } from '@borrowbox/contracts';
import { filter, lastValueFrom } from 'rxjs';
import { Api } from '../../api/api';
import {
  myItemsControllerConfirmPhoto,
  myItemsControllerCreate,
  myItemsControllerCreatePhotoUpload,
  myItemsControllerDeletePhoto,
  myItemsControllerGet,
  myItemsControllerPublish,
  myItemsControllerReorderPhotos,
  myItemsControllerSetLocation,
  myItemsControllerUpdate,
} from '../../api/functions';
import type {
  CreateItemBody,
  OwnItemResponse,
  UpdateItemBody,
} from '../../api/models';
import { errorCode, type KnownErrorCode } from '../../core/api-errors';
import { preparePhoto, type PhotoProblem } from './photo-prep';

/** A photo on its way: chosen, uploading, or waiting for processing. */
export interface PhotoUpload {
  key: string;
  name: string;
  state: 'preparing' | 'uploading' | 'processing' | 'failed';
  /** 0–1 while uploading. */
  progress: number;
  problem: PhotoProblem | KnownErrorCode | null;
}

interface ListingState {
  /** Chosen by the browser for a new item, so a retried create is safe. */
  itemId: string;
  mode: 'create' | 'edit';
  item: OwnItemResponse | null;
  status: 'loading' | 'ready' | 'error';
  saving: boolean;
  error: KnownErrorCode | null;
  uploads: PhotoUpload[];
}

/** Two uploads at a time: phones on mobile data shouldn't choke. */
const UPLOAD_CONCURRENCY = 2;
const POLL_EVERY_MS = 2000;
const POLL_TRIES = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The listing wizard (step 12d): creates or edits one of the caller's
 * items. Every write returns the saved item, which replaces the local
 * copy, so the screen always shows what the server holds.
 */
export const ListingStore = signalStore(
  withState<ListingState>({
    itemId: '',
    mode: 'create',
    item: null,
    status: 'loading',
    saving: false,
    error: null,
    uploads: [],
  }),
  withComputed(({ item, uploads }) => ({
    readyPhotos: computed(
      () => item()?.photos.filter((p) => p.status === 'READY').length ?? 0,
    ),
    /** Room left for photos (failed ones count until removed, P2). */
    photoSlotsLeft: computed(
      () =>
        ITEM_PHOTOS_MAX -
        (item()?.photos.length ?? 0) -
        uploads().filter((u) => u.state !== 'failed').length,
    ),
    sortedPhotos: computed(() =>
      [...(item()?.photos ?? [])].sort((a, b) => a.position - b.position),
    ),
  })),
  withProps(() => ({
    _api: inject(Api),
    _http: inject(HttpClient),
    _meta: {
      destroyed: false,
      queue: [] as Array<() => Promise<void>>,
      running: 0,
    },
  })),
  withMethods((store) => {
    /** Runs a write; on failure keeps the error for the screen and returns null. */
    const write = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      patchState(store, { saving: true, error: null });
      try {
        return await fn();
      } catch (err) {
        patchState(store, { error: errorCode(err) });
        return null;
      } finally {
        patchState(store, { saving: false });
      }
    };
    const setItem = (item: OwnItemResponse) => patchState(store, { item });
    const itemId = () => store.item()?.id ?? store.itemId();
    const updateUpload = (key: string, patch: Partial<PhotoUpload>) =>
      patchState(store, {
        uploads: store
          .uploads()
          .map((u) => (u.key === key ? { ...u, ...patch } : u)),
      });
    const dropUpload = (key: string) =>
      patchState(store, {
        uploads: store.uploads().filter((u) => u.key !== key),
      });

    /** Waits for the server to process the photo (READY or FAILED). */
    const waitForProcessing = async (photoId: string): Promise<void> => {
      for (let i = 0; i < POLL_TRIES && !store._meta.destroyed; i++) {
        await sleep(POLL_EVERY_MS);
        const item = await store._api.invoke(myItemsControllerGet, {
          itemId: itemId(),
        });
        setItem(item);
        const photo = item.photos.find((p) => p.id === photoId);
        if (!photo || photo.status !== 'PENDING') return;
      }
    };

    const uploadOne = async (key: string, file: File): Promise<void> => {
      const prepared = await preparePhoto(file);
      if (!prepared.ok) {
        updateUpload(key, { state: 'failed', problem: prepared.problem });
        return;
      }
      try {
        const target = await store._api.invoke(
          myItemsControllerCreatePhotoUpload,
          {
            itemId: itemId(),
            body: {
              contentType: prepared.contentType,
              sizeBytes: prepared.blob.size,
            },
          },
        );
        updateUpload(key, { state: 'uploading' });
        // Straight to object storage (presigned URL), not through the gateway.
        await lastValueFrom(
          store._http
            .request(
              new HttpRequest('PUT', target.uploadUrl, prepared.blob, {
                headers: new HttpHeaders(target.uploadHeaders),
                reportProgress: true,
              }),
            )
            .pipe(
              filter((event) => {
                if (
                  event.type === HttpEventType.UploadProgress &&
                  event.total
                ) {
                  updateUpload(key, { progress: event.loaded / event.total });
                }
                return event.type === HttpEventType.Response;
              }),
            ),
        );
        updateUpload(key, { state: 'processing', progress: 1 });
        await store._api.invoke(myItemsControllerConfirmPhoto, {
          itemId: itemId(),
          photoId: target.photoId,
        });
        await waitForProcessing(target.photoId);
        dropUpload(key);
      } catch (err) {
        updateUpload(key, { state: 'failed', problem: errorCode(err) });
      }
    };

    const pump = () => {
      while (
        store._meta.running < UPLOAD_CONCURRENCY &&
        store._meta.queue.length > 0
      ) {
        const next = store._meta.queue.shift() as () => Promise<void>;
        store._meta.running++;
        void next().finally(() => {
          store._meta.running--;
          pump();
        });
      }
    };

    return {
      /** A new item: its id is picked now and used for every write. */
      startNew(): void {
        patchState(store, {
          mode: 'create',
          itemId: globalThis.crypto.randomUUID(),
          item: null,
          status: 'ready',
          error: null,
          uploads: [],
        });
      },

      async load(id: string): Promise<void> {
        patchState(store, { mode: 'edit', itemId: id, status: 'loading' });
        try {
          setItem(
            await store._api.invoke(myItemsControllerGet, { itemId: id }),
          );
          patchState(store, { status: 'ready', error: null });
        } catch (err) {
          patchState(store, { status: 'error', error: errorCode(err) });
        }
      },

      /** Creates the draft the first time, then saves only what changed. */
      async saveDetails(
        create: () => CreateItemBody,
        update: (item: OwnItemResponse) => UpdateItemBody | null,
      ): Promise<boolean> {
        const current = store.item();
        if (!current) {
          const item = await write(() =>
            store._api.invoke(myItemsControllerCreate, { body: create() }),
          );
          if (item) setItem(item);
          return item !== null;
        }
        const body = update(current);
        if (!body) return true;
        const item = await write(() =>
          store._api.invoke(myItemsControllerUpdate, {
            itemId: current.id,
            body,
          }),
        );
        if (item) setItem(item);
        return item !== null;
      },

      async saveLocation(location: GeoPoint): Promise<boolean> {
        const item = await write(() =>
          store._api.invoke(myItemsControllerSetLocation, {
            itemId: itemId(),
            body: { location },
          }),
        );
        if (item) setItem(item);
        return item !== null;
      },

      /** Queues the files; extra ones beyond the photo limit are ignored. */
      addPhotos(files: readonly File[]): number {
        const room = Math.max(0, store.photoSlotsLeft());
        const accepted = files.slice(0, room);
        for (const file of accepted) {
          const key = globalThis.crypto.randomUUID();
          patchState(store, {
            uploads: [
              ...store.uploads(),
              {
                key,
                name: file.name,
                state: 'preparing',
                progress: 0,
                problem: null,
              },
            ],
          });
          store._meta.queue.push(() => uploadOne(key, file));
        }
        pump();
        return files.length - accepted.length;
      },

      dismissUpload(key: string): void {
        dropUpload(key);
      },

      async removePhoto(photoId: string): Promise<void> {
        const ok = await write(() =>
          store._api.invoke(myItemsControllerDeletePhoto, {
            itemId: itemId(),
            photoId,
          }),
        );
        if (ok !== null) {
          const item = store.item();
          if (item) {
            setItem({
              ...item,
              photos: item.photos.filter((p) => p.id !== photoId),
            });
          }
        }
      },

      async reorder(photoIds: string[]): Promise<void> {
        const item = store.item();
        if (!item) return;
        // Show the new order at once; the answer confirms it.
        const position = new Map(photoIds.map((id, i) => [id, i]));
        setItem({
          ...item,
          photos: item.photos.map((p) => ({
            ...p,
            position: position.get(p.id) ?? p.position,
          })),
        });
        const photos = await write(() =>
          store._api.invoke(myItemsControllerReorderPhotos, {
            itemId: item.id,
            body: { photoIds },
          }),
        );
        if (photos) setItem({ ...(store.item() as OwnItemResponse), photos });
        else setItem(item);
      },

      async publish(): Promise<boolean> {
        const item = await write(() =>
          store._api.invoke(myItemsControllerPublish, { itemId: itemId() }),
        );
        if (item) setItem(item);
        return item !== null;
      },

      clearError(): void {
        patchState(store, { error: null });
      },
    };
  }),
  withHooks((store) => ({
    onDestroy() {
      // Stops polling; uploads already sent finish on the server anyway.
      store._meta.destroyed = true;
      store._meta.queue.length = 0;
    },
  })),
);

export type ListingStore = InstanceType<typeof ListingStore>;
