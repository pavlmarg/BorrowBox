import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { ITEM_FREE_LIMIT } from '@borrowbox/contracts';
import { Api } from '../../api/api';
import {
  myItemsControllerDelete,
  myItemsControllerList,
  myItemsControllerPause,
  myItemsControllerPublish,
  myItemsControllerUnpause,
} from '../../api/functions';
import type { OwnItemResponse } from '../../api/models';
import { errorCode, type KnownErrorCode } from '../../core/api-errors';

export type ItemAction = 'publish' | 'pause' | 'unpause' | 'delete';

interface MyItemsState {
  items: OwnItemResponse[];
  status: 'loading' | 'ready' | 'error';
  error: KnownErrorCode | null;
  /** The item an action is running for, so its buttons can wait. */
  busyId: string | null;
}

const ACTIONS = {
  publish: myItemsControllerPublish,
  pause: myItemsControllerPause,
  unpause: myItemsControllerUnpause,
} as const;

/**
 * The lender's items (step 12e). Every action answers with the saved item,
 * which replaces the row: no optimistic guesses.
 */
export const MyItemsStore = signalStore(
  withState<MyItemsState>({
    items: [],
    status: 'loading',
    error: null,
    busyId: null,
  }),
  withComputed(({ items }) => ({
    count: computed(() => items().length),
    atLimit: computed(() => items().length >= ITEM_FREE_LIMIT),
  })),
  withProps(() => ({ _api: inject(Api) })),
  withMethods((store) => ({
    async load(): Promise<void> {
      patchState(store, { status: 'loading', error: null });
      try {
        const items = await store._api.invoke(myItemsControllerList, {});
        patchState(store, { items, status: 'ready' });
      } catch (err) {
        patchState(store, { status: 'error', error: errorCode(err) });
      }
    },

    /** Runs an action; resolves with the error code if it failed. */
    async act(
      itemId: string,
      action: ItemAction,
    ): Promise<KnownErrorCode | null> {
      patchState(store, { busyId: itemId });
      try {
        if (action === 'delete') {
          await store._api.invoke(myItemsControllerDelete, { itemId });
          patchState(store, {
            items: store.items().filter((i) => i.id !== itemId),
          });
        } else {
          const item = await store._api.invoke(ACTIONS[action], { itemId });
          patchState(store, {
            items: store.items().map((i) => (i.id === itemId ? item : i)),
          });
        }
        return null;
      } catch (err) {
        return errorCode(err);
      } finally {
        patchState(store, { busyId: null });
      }
    },
  })),
);

export type MyItemsStore = InstanceType<typeof MyItemsStore>;
