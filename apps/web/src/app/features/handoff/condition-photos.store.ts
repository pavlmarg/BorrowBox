import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { lastValueFrom } from 'rxjs';
import { Api } from '../../api/api';
import {
  bookingsControllerAddPhoto,
  bookingsControllerConfirmPhoto,
  bookingsControllerPhotos,
  bookingsControllerRemovePhoto,
} from '../../api/functions';
import type {
  CanAddConditionPhotosResponse,
  ConditionPhotoResponse,
  HandoffPhase,
} from '../../api/models';
import { preparePhoto, type PhotoProblem } from '../../shared/photo/photo-prep';
import {
  bookingErrorCode,
  type AnyBookingError,
} from '../bookings/booking-text';

const POLL_EVERY_MS = 1000;
const POLL_TRIES = 30;
/** Fetch fresh links this long before the old ones stop working. */
const LINK_MARGIN_MS = 30_000;

/** Why adding a photo failed: the file, the server refusing it, or a call. */
export type ConditionPhotoProblem = PhotoProblem | 'REJECTED' | AnyBookingError;

interface ConditionPhotosState {
  photos: ConditionPhotoResponse[];
  canAdd: CanAddConditionPhotosResponse;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** The phase a photo is being added to, so its button can wait. */
  adding: HandoffPhase | null;
  removing: string | null;
  problem: ConditionPhotoProblem | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A booking's condition photos (ADR-0027): both people's, with private links
 * that last 5 minutes. Adding re-encodes in the browser, uploads straight to
 * storage, confirms, then waits for the server to process it.
 */
export const ConditionPhotosStore = signalStore(
  withState<ConditionPhotosState>({
    photos: [],
    canAdd: { PICKUP: false, RETURN: false },
    status: 'idle',
    adding: null,
    removing: null,
    problem: null,
  }),
  withProps(() => ({
    _api: inject(Api),
    _http: inject(HttpClient),
    _meta: { seq: 0 },
  })),
  withMethods((store) => {
    const load = async (bookingId: string, quiet = false): Promise<void> => {
      const seq = ++store._meta.seq;
      if (!quiet) patchState(store, { status: 'loading' });
      try {
        const { photos, canAdd } = await store._api.invoke(
          bookingsControllerPhotos,
          { bookingId },
        );
        if (seq !== store._meta.seq) return;
        patchState(store, { photos, canAdd, status: 'ready' });
      } catch {
        if (seq !== store._meta.seq) return;
        // A quiet refresh that fails keeps what's shown.
        if (!quiet) patchState(store, { status: 'error' });
      }
    };

    return {
      load,

      /** Reloads (new links) once any shown link is about to expire. */
      async refreshLinks(bookingId: string, now = new Date()): Promise<void> {
        const soon = now.getTime() + LINK_MARGIN_MS;
        const stale = store
          .photos()
          .some((p) => p.urlsExpireAt && Date.parse(p.urlsExpireAt) < soon);
        if (stale) await load(bookingId, true);
      },

      async add(
        bookingId: string,
        phase: HandoffPhase,
        file: File,
      ): Promise<void> {
        if (store.adding()) return;
        patchState(store, { adding: phase, problem: null });
        try {
          const prepared = await preparePhoto(file);
          if (!prepared.ok) {
            patchState(store, { problem: prepared.problem });
            return;
          }
          const photoId = globalThis.crypto.randomUUID();
          const target = await store._api.invoke(bookingsControllerAddPhoto, {
            bookingId,
            body: {
              photoId,
              phase,
              contentType: prepared.contentType,
              sizeBytes: prepared.blob.size,
            },
          });
          // Straight to object storage (presigned URL), not through the gateway.
          await lastValueFrom(
            store._http.put(target.uploadUrl, prepared.blob, {
              headers: new HttpHeaders(target.uploadHeaders),
            }),
          );
          let photo = await store._api.invoke(bookingsControllerConfirmPhoto, {
            bookingId,
            photoId,
          });
          await load(bookingId, true);
          for (let i = 0; i < POLL_TRIES && photo.status === 'PENDING'; i++) {
            await sleep(POLL_EVERY_MS);
            await load(bookingId, true);
            photo = store.photos().find((p) => p.id === photoId) ?? photo;
          }
          if (photo.status === 'FAILED')
            patchState(store, { problem: 'REJECTED' });
        } catch (err) {
          patchState(store, { problem: bookingErrorCode(err) });
        } finally {
          patchState(store, { adding: null });
        }
      },

      async remove(bookingId: string, photoId: string): Promise<void> {
        if (store.removing()) return;
        patchState(store, { removing: photoId, problem: null });
        try {
          await store._api.invoke(bookingsControllerRemovePhoto, {
            bookingId,
            photoId,
          });
          patchState(store, {
            photos: store.photos().filter((p) => p.id !== photoId),
          });
        } catch (err) {
          patchState(store, { problem: bookingErrorCode(err) });
          await load(bookingId, true);
        } finally {
          patchState(store, { removing: null });
        }
      },

      clearProblem(): void {
        patchState(store, { problem: null });
      },
    };
  }),
);

export type ConditionPhotosStore = InstanceType<typeof ConditionPhotosStore>;
