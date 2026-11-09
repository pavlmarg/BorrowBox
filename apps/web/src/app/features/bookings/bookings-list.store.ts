import { inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { Api } from '../../api/api';
import { myBookingsControllerList } from '../../api/functions';
import type { BookingStatus, BookingViewResponse } from '../../api/models';
import { errorCode, type KnownErrorCode } from '../../core/api-errors';
import { CURRENT_STATUSES, PAST_STATUSES } from './booking-text';

export type ListRole = 'renter' | 'lender';
export type ListShow = 'current' | 'past' | 'all';

export const LIST_PAGE_SIZE = 20;

export function parseRole(value: string | null | undefined): ListRole {
  return value === 'lender' ? 'lender' : 'renter';
}

export function parseShow(value: string | null | undefined): ListShow {
  return value === 'past' || value === 'all' ? value : 'current';
}

function statusesFor(show: ListShow): BookingStatus[] | undefined {
  if (show === 'current') return [...CURRENT_STATUSES];
  if (show === 'past') return [...PAST_STATUSES];
  return undefined;
}

interface BookingsListState {
  bookings: BookingViewResponse[];
  nextCursor: string | null;
  status: 'loading' | 'ready' | 'error';
  error: KnownErrorCode | null;
  loadingMore: boolean;
  moreError: KnownErrorCode | null;
}

/**
 * The caller's bookings on one side (renting or lending), filtered by
 * current / past, a page at a time ("Load more" with the API's cursor).
 */
export const BookingsListStore = signalStore(
  withState<BookingsListState>({
    bookings: [],
    nextCursor: null,
    status: 'loading',
    error: null,
    loadingMore: false,
    moreError: null,
  }),
  withProps(() => ({
    _api: inject(Api),
    _meta: { seq: 0, role: 'renter' as ListRole, show: 'current' as ListShow },
  })),
  withMethods((store) => {
    const fetch = (cursor?: string) =>
      store._api.invoke(myBookingsControllerList, {
        role: store._meta.role === 'lender' ? 'LENDER' : 'RENTER',
        statuses: statusesFor(store._meta.show),
        cursor,
        limit: LIST_PAGE_SIZE,
      });

    return {
      async load(role: ListRole, show: ListShow): Promise<void> {
        const seq = ++store._meta.seq;
        store._meta.role = role;
        store._meta.show = show;
        patchState(store, {
          status: 'loading',
          error: null,
          bookings: [],
          nextCursor: null,
          loadingMore: false,
          moreError: null,
        });
        try {
          const page = await fetch();
          if (seq !== store._meta.seq) return;
          patchState(store, {
            status: 'ready',
            bookings: page.bookings,
            nextCursor: page.nextCursor,
          });
        } catch (err) {
          if (seq !== store._meta.seq) return;
          patchState(store, { status: 'error', error: errorCode(err) });
        }
      },

      async loadMore(): Promise<void> {
        const cursor = store.nextCursor();
        if (!cursor || store.loadingMore()) return;
        const seq = store._meta.seq;
        patchState(store, { loadingMore: true, moreError: null });
        try {
          const page = await fetch(cursor);
          if (seq !== store._meta.seq) return;
          const seen = new Set(store.bookings().map((b) => b.id));
          patchState(store, {
            bookings: [
              ...store.bookings(),
              ...page.bookings.filter((b) => !seen.has(b.id)),
            ],
            nextCursor: page.nextCursor,
          });
        } catch (err) {
          if (seq !== store._meta.seq) return;
          patchState(store, { moreError: errorCode(err) });
        } finally {
          if (seq === store._meta.seq)
            patchState(store, { loadingMore: false });
        }
      },
    };
  }),
);

export type BookingsListStore = InstanceType<typeof BookingsListStore>;
