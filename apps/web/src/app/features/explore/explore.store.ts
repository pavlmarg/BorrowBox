import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import type { GeoPoint, SearchRadiusKm } from '@borrowbox/contracts';
import { Api } from '../../api/api';
import {
  publicItemsControllerFeatured,
  publicItemsControllerSearch,
} from '../../api/functions';
import type { PublicItemSummaryResponse } from '../../api/models';
import { errorCode, type KnownErrorCode } from '../../core/api-errors';
import { DEFAULT_CENTER } from '../../shared/map/geo';
import {
  DEFAULT_FILTERS,
  sameFilters,
  searchBody,
  type ExploreFilters,
} from './explore-query';

export type ExploreStatus = 'idle' | 'loading' | 'ready' | 'error';

interface ExploreState {
  /** The searcher's point: in memory only, never in the URL or storage. */
  center: GeoPoint;
  filters: ExploreFilters;
  items: PublicItemSummaryResponse[];
  nextCursor: string | null;
  status: ExploreStatus;
  loadingMore: boolean;
  error: KnownErrorCode | null;
  /** Highlighted in both the list and the map. */
  selectedId: string | null;
  /** The list's scroll position, restored when coming back (E10). */
  scrollTop: number;
  /** The carousel above the results: by area and radius only, never filters. */
  featured: PublicItemSummaryResponse[];
}

const initialState: ExploreState = {
  center: DEFAULT_CENTER,
  filters: DEFAULT_FILTERS,
  items: [],
  nextCursor: null,
  status: 'idle',
  loadingMore: false,
  error: null,
  selectedId: null,
  scrollTop: 0,
  featured: [],
};

/**
 * Explore's search. App-wide (not per page), so the results, area and
 * scroll position survive a visit to an item page (E10). Only the newest
 * request counts: an older answer arriving late is dropped.
 */
export const ExploreStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ items, nextCursor, status }) => ({
    hasMore: computed(() => nextCursor() !== null),
    isEmpty: computed(() => status() === 'ready' && items().length === 0),
  })),
  withProps(() => ({
    _api: inject(Api),
    /** Bumped by every new search; answers to older ones are ignored. */
    _meta: { seq: 0, featuredFor: null as string | null },
  })),
  withMethods((store) => {
    /**
     * Featured items for the current area and radius, unless already loaded.
     * Best effort: a failure just leaves the carousel out.
     */
    const loadFeatured = async (): Promise<void> => {
      const near = store.center();
      const radiusKm = store.filters().radiusKm;
      const key = `${near.lat},${near.lng},${radiusKm}`;
      if (key === store._meta.featuredFor) return;
      store._meta.featuredFor = key;
      patchState(store, { featured: [] });
      try {
        const { items } = await store._api.invoke(
          publicItemsControllerFeatured,
          { body: { near, radiusKm } },
        );
        if (key === store._meta.featuredFor) {
          patchState(store, { featured: items });
        }
      } catch {
        // Tried again with the next search.
        if (key === store._meta.featuredFor) store._meta.featuredFor = null;
      }
    };

    const search = async (): Promise<void> => {
      void loadFeatured();
      const seq = ++store._meta.seq;
      patchState(store, {
        status: 'loading',
        loadingMore: false,
        error: null,
        items: [],
        nextCursor: null,
        selectedId: null,
        scrollTop: 0,
      });
      try {
        const page = await store._api.invoke(publicItemsControllerSearch, {
          body: searchBody(store.filters(), store.center()),
        });
        if (seq !== store._meta.seq) return;
        patchState(store, {
          status: 'ready',
          items: page.items,
          nextCursor: page.nextCursor,
        });
      } catch (err) {
        if (seq !== store._meta.seq) return;
        patchState(store, { status: 'error', error: errorCode(err) });
      }
    };

    return {
      search,

      /**
       * Opening Explore: searches with the URL's filters, unless the same
       * search is already on screen (coming back from an item, E10).
       */
      start(filters: ExploreFilters): Promise<void> {
        if (
          store.status() !== 'idle' &&
          sameFilters(filters, store.filters())
        ) {
          return Promise.resolve();
        }
        patchState(store, { filters });
        return search();
      },

      setFilters(patch: Partial<ExploreFilters>): Promise<void> {
        const filters = { ...store.filters(), ...patch };
        if (sameFilters(filters, store.filters())) return Promise.resolve();
        patchState(store, { filters });
        return search();
      },

      setArea(center: GeoPoint): Promise<void> {
        patchState(store, { center });
        return search();
      },

      /** "Search this area": a new centre and the radius covering the view, one search. */
      searchArea(center: GeoPoint, radiusKm: SearchRadiusKm): Promise<void> {
        patchState(store, {
          center,
          filters: { ...store.filters(), radiusKm },
        });
        return search();
      },

      async loadMore(): Promise<void> {
        const cursor = store.nextCursor();
        if (!cursor || store.loadingMore() || store.status() !== 'ready') {
          return;
        }
        const seq = store._meta.seq;
        patchState(store, { loadingMore: true, error: null });
        try {
          const page = await store._api.invoke(publicItemsControllerSearch, {
            body: searchBody(store.filters(), store.center(), cursor),
          });
          if (seq !== store._meta.seq) return;
          patchState(store, {
            items: [...store.items(), ...page.items],
            nextCursor: page.nextCursor,
            loadingMore: false,
          });
        } catch (err) {
          if (seq !== store._meta.seq) return;
          patchState(store, { loadingMore: false, error: errorCode(err) });
        }
      },

      select(selectedId: string | null): void {
        patchState(store, { selectedId });
      },

      saveScroll(scrollTop: number): void {
        patchState(store, { scrollTop });
      },
    };
  }),
);

export type ExploreStore = InstanceType<typeof ExploreStore>;
