import { inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { Api } from '../../api/api';
import {
  usersControllerItems,
  usersControllerProfile,
} from '../../api/functions';
import type {
  LenderItemResponse,
  PublicProfileResponse,
} from '../../api/models';
import { errorCode, type KnownErrorCode } from '../../core/api-errors';

interface PersonState {
  profile: PublicProfileResponse | null;
  items: LenderItemResponse[];
  status: 'loading' | 'ready' | 'error';
  error: KnownErrorCode | null;
}

/**
 * Someone's public profile and their items (ADR-0025), one per page. The
 * two load together; if only the items fail, the profile shows without them.
 */
export const PersonStore = signalStore(
  withState<PersonState>({
    profile: null,
    items: [],
    status: 'loading',
    error: null,
  }),
  withProps(() => ({ _api: inject(Api), _meta: { seq: 0 } })),
  withMethods((store) => ({
    async load(userId: string): Promise<void> {
      const seq = ++store._meta.seq;
      patchState(store, {
        status: 'loading',
        error: null,
        profile: null,
        items: [],
      });
      const [profile, items] = await Promise.allSettled([
        store._api.invoke(usersControllerProfile, { userId }),
        store._api.invoke(usersControllerItems, { userId }),
      ]);
      if (seq !== store._meta.seq) return;
      if (profile.status === 'rejected') {
        patchState(store, {
          status: 'error',
          error: errorCode(profile.reason),
        });
        return;
      }
      patchState(store, {
        status: 'ready',
        profile: profile.value,
        items: items.status === 'fulfilled' ? items.value.items : [],
      });
    },
  })),
);

export type PersonStore = InstanceType<typeof PersonStore>;
