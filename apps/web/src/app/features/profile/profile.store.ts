import { HttpClient, HttpHeaders } from '@angular/common/http';
import { DOCUMENT, inject } from '@angular/core';
import { lastValueFrom } from 'rxjs';
import {
  patchState,
  signalStore,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { Api } from '../../api/api';
import {
  meControllerConfirmPhoto,
  meControllerDelete,
  meControllerExport,
  meControllerGet,
  meControllerRemovePhoto,
  meControllerRequestPhotoUpload,
  meControllerUpdate,
} from '../../api/functions';
import type { UpdateProfileBody } from '../../api/models';
import { errorCode, type KnownErrorCode } from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';
import type { PhotoProblem } from '../listing/photo-prep';
import { prepareProfilePhoto } from './profile-photo-prep';

type Busy = 'saving' | 'exporting' | 'deleting' | null;

/** How long the export's download URL stays valid after the click. */
const EXPORT_URL_LIFETIME_MS = 60_000;
/** Processing takes a few seconds; give up showing progress after ~30 s. */
const PHOTO_POLL_EVERY_MS = 1000;
const PHOTO_POLL_TRIES = 30;

/** A new profile photo on its way (ADR-0024). */
export type PhotoStep = 'idle' | 'uploading' | 'processing' | 'removing';

interface ProfileState {
  busy: Busy;
  error: KnownErrorCode | null;
  saved: boolean;
  exported: boolean;
  photoStep: PhotoStep;
  /** Why the last photo couldn't be used; `REJECTED`: the server refused the image. */
  photoProblem: PhotoProblem | KnownErrorCode | 'REJECTED' | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Account page state. The profile itself lives in AuthStore (it is the
 * signed-in user); this store owns the page's operations.
 */
export const ProfileStore = signalStore(
  withState<ProfileState>({
    busy: null,
    error: null,
    saved: false,
    exported: false,
    photoStep: 'idle',
    photoProblem: null,
  }),
  withProps(() => ({
    _api: inject(Api),
    _http: inject(HttpClient),
    _auth: inject(AuthStore),
    _document: inject(DOCUMENT),
  })),
  withMethods((store) => {
    const run = async <T>(
      busy: Busy,
      fn: () => Promise<T>,
    ): Promise<T | undefined> => {
      patchState(store, { busy, error: null, saved: false, exported: false });
      try {
        return await fn();
      } catch (err) {
        patchState(store, { error: errorCode(err) });
        return undefined;
      } finally {
        patchState(store, { busy: null });
      }
    };

    return {
      /** Picks up changes made in other tabs or devices. */
      async load(): Promise<void> {
        const user = await run(null, () => store._api.invoke(meControllerGet));
        if (user) store._auth.updateUser(user);
      },

      async save(changes: UpdateProfileBody): Promise<boolean> {
        const user = await run('saving', () =>
          store._api.invoke(meControllerUpdate, { body: changes }),
        );
        if (!user) return false;
        store._auth.updateUser(user);
        patchState(store, { saved: true });
        return true;
      },

      /** Fetched with the bearer token (never a token in a URL), then saved as a file. */
      async exportData(): Promise<void> {
        const data = await run('exporting', () =>
          store._api.invoke(meControllerExport),
        );
        if (!data) return;
        const blob = new Blob([JSON.stringify(data, null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = store._document.createElement('a');
        link.href = url;
        link.download = 'borrowbox-data-export.json';
        // Attached and revoked later: some browsers (Firefox, Safari) ignore
        // a click on a detached link or cancel a download whose URL is
        // revoked before it started.
        link.hidden = true;
        store._document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), EXPORT_URL_LIFETIME_MS);
        patchState(store, { exported: true });
      },

      /** Resolves true once the account is gone (and the session cleared). */
      async deleteAccount(password: string | undefined): Promise<boolean> {
        const done = await run('deleting', async () => {
          await store._api.invoke(meControllerDelete, {
            body: password === undefined ? {} : { password },
          });
          return true;
        });
        if (!done) return false;
        store._auth.signedOut();
        return true;
      },

      /**
       * A new profile photo: cropped to a square in the browser, uploaded
       * straight to storage, confirmed, then polled until the server has
       * processed it. The current photo stays until the new one is ready.
       */
      async changePhoto(file: File): Promise<void> {
        if (store.photoStep() !== 'idle') return;
        patchState(store, { photoStep: 'uploading', photoProblem: null });
        try {
          const prepared = await prepareProfilePhoto(file);
          if (!prepared.ok) {
            patchState(store, { photoProblem: prepared.problem });
            return;
          }
          const target = await store._api.invoke(
            meControllerRequestPhotoUpload,
            {
              body: {
                contentType: prepared.contentType,
                sizeBytes: prepared.blob.size,
              },
            },
          );
          // Straight to object storage (presigned URL), not through the gateway.
          await lastValueFrom(
            store._http.put(target.uploadUrl, prepared.blob, {
              headers: new HttpHeaders(target.uploadHeaders),
            }),
          );
          patchState(store, { photoStep: 'processing' });
          let user = await store._api.invoke(meControllerConfirmPhoto);
          store._auth.updateUser(user);
          for (
            let i = 0;
            i < PHOTO_POLL_TRIES && user.photoUpload === 'PENDING';
            i++
          ) {
            await sleep(PHOTO_POLL_EVERY_MS);
            user = await store._api.invoke(meControllerGet);
            store._auth.updateUser(user);
          }
          if (user.photoUpload === 'FAILED') {
            patchState(store, { photoProblem: 'REJECTED' });
          }
        } catch (err) {
          patchState(store, { photoProblem: errorCode(err) });
        } finally {
          patchState(store, { photoStep: 'idle' });
        }
      },

      /** Back to the silhouette. */
      async removePhoto(): Promise<void> {
        if (store.photoStep() !== 'idle') return;
        patchState(store, { photoStep: 'removing', photoProblem: null });
        try {
          store._auth.updateUser(
            await store._api.invoke(meControllerRemovePhoto),
          );
        } catch (err) {
          patchState(store, { photoProblem: errorCode(err) });
        } finally {
          patchState(store, { photoStep: 'idle' });
        }
      },

      clearError(): void {
        patchState(store, { error: null });
      },
    };
  }),
);
