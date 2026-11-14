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
  usersControllerItems,
} from '../../api/functions';
import type {
  LenderItemResponse,
  PublicItemDetailResponse,
  PublicItemSummaryResponse,
} from '../../api/models';
import { errorCode, type KnownErrorCode } from '../../core/api-errors';

interface ItemState {
  item: PublicItemDetailResponse | null;
  similar: PublicItemSummaryResponse[];
  /** The lender's other items ("More from …", ADR-0025). */
  moreFromLender: LenderItemResponse[];
  status: 'loading' | 'ready' | 'error';
  error: KnownErrorCode | null;
}

/**
 * The public item page (step 12c). One per page. Similar items and the
 * lender's other items are a bonus: if they fail to load, the page shows
 * without them.
 */
export const ItemStore = signalStore(
  withState<ItemState>({
    item: null,
    similar: [],
    moreFromLender: [],
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
        moreFromLender: [],
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

      // Needs the lender's id, so it follows the item.
      try {
        const more = await store._api.invoke(usersControllerItems, {
          userId: item.value.lender.id,
        });
        if (seq !== store._meta.seq) return;
        patchState(store, {
          moreFromLender: more.items.filter((i) => i.id !== itemId),
        });
      } catch {
        // A bonus: the page is complete without it.
      }
    },
  })),
);

export type ItemStore = InstanceType<typeof ItemStore>;
