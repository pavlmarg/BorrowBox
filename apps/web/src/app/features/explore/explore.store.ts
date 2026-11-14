import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import type {
  GeoPoint,
  ItemCategory,
  SearchRadiusKm,
} from '@borrowbox/contracts';
import { Api } from '../../api/api';
import {
  publicItemsControllerCategoryCounts,
  publicItemsControllerFeatured,
  publicItemsControllerSearch,
} from '../../api/functions';
import type { PublicItemSummaryResponse } from '../../api/models';
import { errorCode, type KnownErrorCode } from '../../core/api-errors';
import { DEFAULT_CENTER } from '../../shared/map/geo';
import {
  DEFAULT_FILTERS,
  countsBody,
  sameFilters,
  searchBody,
  type ExploreFilters,
} from './explore-query';

export type ExploreStatus = 'idle' | 'loading' | 'ready' | 'error';

/** "Further away" (ADR-0023): the results beyond the radius, after the last page. */
interface FurtherState {
  items: PublicItemSummaryResponse[];
  nextCursor: string | null;
  status: ExploreStatus;
  loadingMore: boolean;
}
const NO_FURTHER: FurtherState = {
  items: [],
  nextCursor: null,
  status: 'idle',
  loadingMore: false,
};

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
  /**
   * Results each category would give with the other filters; null until
   * loaded (or when loading failed, so nothing shows a wrong number).
   */
  categoryCounts: Partial<Record<ItemCategory, number>> | null;
  further: FurtherState;
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
  categoryCounts: null,
  further: NO_FURTHER,
};

/**
 * Explore's search. App-wide (not per page), so the results, area and
 * scroll position survive a visit to an item page (E10). Only the newest
 * request counts: an older answer arriving late is dropped.
 */
export const ExploreStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ items, nextCursor, status, categoryCounts }) => ({
    /** Every category together, for "All categories". */
    totalCount: computed(() => {
      const counts = categoryCounts();
      return counts === null
        ? null
        : Object.values(counts).reduce((sum, n) => sum + n, 0);
    }),
    hasMore: computed(() => nextCursor() !== null),
    isEmpty: computed(() => status() === 'ready' && items().length === 0),
  })),
  withProps(() => ({
    _api: inject(Api),
    /** Bumped by every new search; answers to older ones are ignored. */
    _meta: {
      seq: 0,
      featuredFor: null as string | null,
      countsFor: null as string | null,
    },
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

    /**
     * The category counts, unless already loaded for these filters (picking
     * a category doesn't change them). Best effort, like the carousel.
     */
    const loadCounts = async (): Promise<void> => {
      const body = countsBody(store.filters(), store.center());
      const key = JSON.stringify(body);
      if (key === store._meta.countsFor) return;
      store._meta.countsFor = key;
      patchState(store, { categoryCounts: null });
      try {
        const { counts } = await store._api.invoke(
          publicItemsControllerCategoryCounts,
          { body },
        );
        if (key === store._meta.countsFor) {
          patchState(store, {
            categoryCounts: Object.fromEntries(
              counts.map((c) => [c.category, c.count]),
            ),
          });
        }
      } catch {
        if (key === store._meta.countsFor) store._meta.countsFor = null;
      }
    };

    /**
     * Once the results within the radius have run out: the first page of
     * what lies beyond it, or the next one. Same filters, nearest first.
     */
    const loadFurther = async (): Promise<void> => {
      const current = store.further();
      const more = current.status === 'ready';
      if (more && (!current.nextCursor || current.loadingMore)) return;
      if (current.status === 'loading') return;
      const seq = store._meta.seq;
      patchState(store, {
        further: more
          ? { ...current, loadingMore: true }
          : { ...NO_FURTHER, status: 'loading' },
      });
      try {
        const page = await store._api.invoke(publicItemsControllerSearch, {
          body: searchBody(
            store.filters(),
            store.center(),
            more ? current.nextCursor : null,
            true,
          ),
        });
        if (seq !== store._meta.seq) return;
        patchState(store, {
          further: {
            items: [...(more ? store.further().items : []), ...page.items],
            nextCursor: page.nextCursor,
            status: 'ready',
            loadingMore: false,
          },
        });
      } catch {
        if (seq !== store._meta.seq) return;
        // Best effort: the button (or the next search) tries again.
        patchState(store, {
          further: more
            ? { ...store.further(), loadingMore: false }
            : { ...NO_FURTHER, status: 'error' },
        });
      }
    };

    const search = async (): Promise<void> => {
      void loadFeatured();
      void loadCounts();
      const seq = ++store._meta.seq;
      patchState(store, {
        status: 'loading',
        loadingMore: false,
        error: null,
        items: [],
        nextCursor: null,
        selectedId: null,
        scrollTop: 0,
        further: NO_FURTHER,
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
        if (page.nextCursor === null) void loadFurther();
      } catch (err) {
        if (seq !== store._meta.seq) return;
        patchState(store, { status: 'error', error: errorCode(err) });
      }
    };

    return {
      search,
      loadFurther,

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
          if (page.nextCursor === null) void loadFurther();
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
