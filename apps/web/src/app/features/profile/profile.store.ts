import { DOCUMENT, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { Api } from '../../api/api';
import {
  meControllerDelete,
  meControllerExport,
  meControllerGet,
  meControllerUpdate,
} from '../../api/functions';
import type { UpdateProfileBody } from '../../api/models';
import { errorCode, type KnownErrorCode } from '../../core/api-errors';
import { AuthStore } from '../../core/auth/auth.store';

type Busy = 'saving' | 'exporting' | 'deleting' | null;

interface ProfileState {
  busy: Busy;
  error: KnownErrorCode | null;
  saved: boolean;
  exported: boolean;
}

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
  }),
  withProps(() => ({
    _api: inject(Api),
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
        link.click();
        URL.revokeObjectURL(url);
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

      clearError(): void {
        patchState(store, { error: null });
      },
    };
  }),
);
