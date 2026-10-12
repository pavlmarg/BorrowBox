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
  publicItemsControllerGet,
  publicItemsControllerSimilar,
} from '../../api/functions';
import type {
  PublicItemDetailResponse,
  PublicItemSummaryResponse,
} from '../../api/models';
import { errorCode, type KnownErrorCode } from '../../core/api-errors';

interface ItemState {
  item: PublicItemDetailResponse | null;
  similar: PublicItemSummaryResponse[];
  status: 'loading' | 'ready' | 'error';
  error: KnownErrorCode | null;
}

/**
 * The public item page (step 12c). One per page. Similar items are a
 * bonus: if they fail to load, the page shows without them.
 */
export const ItemStore = signalStore(
  withState<ItemState>({
    item: null,
    similar: [],
    status: 'loading',
    error: null,
  }),
  withProps(() => ({ _api: inject(Api), _meta: { seq: 0 } })),
  withMethods((store) => ({
    async load(itemId: string): Promise<void> {
      const seq = ++store._meta.seq;
      patchState(store, {
        status: 'loading',
        error: null,
        item: null,
        similar: [],
      });
      const [item, similar] = await Promise.allSettled([
        store._api.invoke(publicItemsControllerGet, { itemId }),
        store._api.invoke(publicItemsControllerSimilar, { itemId }),
      ]);
      if (seq !== store._meta.seq) return;
      if (item.status === 'rejected') {
        patchState(store, { status: 'error', error: errorCode(item.reason) });
        return;
      }
      patchState(store, {
        status: 'ready',
        item: item.value,
        similar: similar.status === 'fulfilled' ? similar.value.items : [],
      });
    },
  })),
);

export type ItemStore = InstanceType<typeof ItemStore>;
