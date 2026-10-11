import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { GeoPoint } from '@borrowbox/contracts';
import { map } from 'rxjs';
import { NavIcon } from '../../core/layout/nav-icon';
import {
  GeolocationError,
  GeolocationService,
} from '../../shared/geo/geolocation';
import { distanceM, zoomForRadius } from '../../shared/map/geo';
import type { MapPoint } from '../../shared/map/map-layers';
import { MapView, type MapCamera } from '../../shared/map/map-view';
import { filtersFromQuery, filtersToQuery } from './explore-query';
import { ExploreFilters } from './explore-filters';
import { ExploreStore } from './explore.store';
import { ResultRow } from '../../shared/catalog/result-row';
import { SearchBar } from './search-bar';

/** Same breakpoint as the app shell's sidebar. */
const WIDE = '(min-width: 960px)';
/** "Search this area" appears once the map moved this share of the radius. */
const AREA_MOVE_SHARE = 0.2;
const SKELETON_ROWS = [1, 2, 3, 4, 5, 6];

/**
 * Explore (step 12b): search near a point, results as a list or on a map.
 * Public. The map is the list's alternative, not a side panel: it lies over
 * the list and a floating button switches between them, so the list keeps
 * its scroll position and the map its size.
 */
@Component({
  selector: 'bb-explore-page',
  imports: [
    TranslocoDirective,
    MatButtonModule,
    MatProgressSpinnerModule,
    MapView,
    NavIcon,
    SearchBar,
    ExploreFilters,
    ResultRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="explore" *transloco="let t" [class.wide]="wide()">
      <section class="list-pane" [attr.aria-label]="t('explore.results')">
        <div class="head">
          <h1 class="visually-hidden">{{ t('nav.explore') }}</h1>
          <div class="search-row">
            <bb-search-bar />
            <button
              mat-stroked-button
              type="button"
              class="locate-inline"
              [disabled]="locating()"
              [attr.aria-label]="t('geo.useMyLocation')"
              (click)="useMyLocation()"
            >
              <bb-nav-icon name="location" class="button-icon" />
              @if (wide()) {
                {{ t('geo.useMyLocation') }}
              }
            </button>
          </div>
          <bb-explore-filters />
        </div>

        <div class="results" #scroller (scroll)="saveScroll()">
          <div class="column">
            @switch (store.status()) {
              @case ('loading') {
                <ul class="skeleton" [attr.aria-label]="t('explore.loading')">
                  @for (n of skeletonRows; track n) {
                    <li>
                      <span class="block photo"></span
                      ><span class="lines"
                        ><span class="block line"></span
                        ><span class="block line short"></span
                      ></span>
                    </li>
                  }
                </ul>
              }
              @case ('error') {
                <div class="message" role="alert">
                  <p>{{ t('errors.' + store.error()) }}</p>
                  <button
                    mat-stroked-button
                    type="button"
                    (click)="store.search()"
                  >
                    {{ t('explore.retry') }}
                  </button>
                </div>
              }
              @default {
                @if (store.isEmpty()) {
                  <div class="message">
                    <p class="strong">{{ t('explore.empty') }}</p>
                    <p>{{ t('explore.emptyHint') }}</p>
                  </div>
                }
                @for (item of store.items(); track item.id) {
                  <bb-result-row
                    [id]="'result-' + item.id"
                    [item]="item"
                    [selected]="store.selectedId() === item.id"
                    (hovered)="store.select($event)"
                  />
                }
                @if (store.hasMore()) {
                  <div class="more">
                    @if (store.error() && !store.loadingMore()) {
                      <p role="alert">{{ t('errors.' + store.error()) }}</p>
                    }
                    <button
                      mat-stroked-button
                      type="button"
                      [disabled]="store.loadingMore()"
                      (click)="store.loadMore()"
                    >
                      @if (store.loadingMore()) {
                        <mat-spinner diameter="18" />
                      } @else {
                        {{ t('explore.loadMore') }}
                      }
                    </button>
                  </div>
                }
              }
            }
          </div>
        </div>
      </section>

      <section
        class="map-pane"
        #mapPane
        [class.open]="mapOpen()"
        [attr.inert]="mapOpen() ? null : ''"
        [attr.aria-label]="t('explore.map')"
      >
        <bb-map
          mode="browse"
          [center]="view().center"
          [zoom]="view().zoom"
          [points]="points()"
          [selectedId]="store.selectedId()"
          [searchCircle]="searchCircle()"
          (cameraChange)="camera.set($event)"
          (pointSelected)="pick($event)"
        />
        @if (areaMoved()) {
          <button
            mat-flat-button
            type="button"
            class="search-area"
            (click)="searchThisArea()"
          >
            {{ t('explore.searchArea') }}
          </button>
        }
        <button
          mat-stroked-button
          type="button"
          class="locate"
          [disabled]="locating()"
          (click)="useMyLocation()"
        >
          <bb-nav-icon name="location" class="button-icon" />
          {{ t('geo.useMyLocation') }}
        </button>
      </section>

      <button
        mat-flat-button
        type="button"
        class="view-toggle"
        [attr.aria-pressed]="mapOpen()"
        (click)="mapOpen.set(!mapOpen())"
      >
        <bb-nav-icon [name]="mapOpen() ? 'list' : 'map'" class="button-icon" />
        {{ t(mapOpen() ? 'explore.showList' : 'explore.showMap') }}
      </button>
    </div>
  `,
  styles: `
    .explore {
      height: calc(100dvh - 56px);
      position: relative;
    }
    .explore.wide {
      height: 100dvh;
    }

    /* The list: the whole area, its content in a centred column. */
    .list-pane {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .head {
      border-bottom: 1px solid rgb(16 58 99 / 0.08);
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
    }
    .head,
    .column {
      box-sizing: border-box;
      margin: 0 auto;
      max-width: 760px;
      width: 100%;
    }
    .search-row {
      align-items: center;
      display: flex;
      gap: 12px;
    }
    .search-row bb-search-bar {
      flex: 1;
    }
    .locate-inline {
      flex: none;
    }
    .explore:not(.wide) .locate-inline {
      min-width: 0;
      padding: 0 10px;
    }
    .explore:not(.wide) .locate-inline .button-icon {
      margin-right: 0;
    }
    .button-icon {
      display: inline-flex;
      height: 18px;
      margin-right: 6px;
      vertical-align: -3px;
      width: 18px;
    }
    .results {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .column {
      /* Room for the floating Map/List button. */
      padding-bottom: 88px;
    }

    .message {
      color: var(--mat-sys-on-surface-variant);
      padding: 32px 16px;
      text-align: center;
    }
    .message p {
      margin: 0 0 12px;
    }
    .message .strong {
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-title-medium);
    }
    .more {
      align-items: center;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px;
    }
    .more p {
      color: var(--mat-sys-error);
      margin: 0;
    }

    .skeleton {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .skeleton li {
      border-bottom: 1px solid rgb(16 58 99 / 0.08);
      display: flex;
      gap: 14px;
      padding: 12px 16px;
    }
    .block {
      background: rgb(16 58 99 / 0.07);
      display: block;
    }
    .photo {
      height: 96px;
      width: 96px;
    }
    .lines {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 10px;
      padding-top: 6px;
    }
    .line {
      height: 14px;
      width: 80%;
    }
    .line.short {
      width: 45%;
    }

    /* The map: laid over the list, the other way to see the results.
       Hidden with opacity (MapLibre's own CSS would undo visibility) and
       made inert, but kept laid out so the map keeps its size. */
    .map-pane {
      inset: 0;
      opacity: 0;
      pointer-events: none;
      position: absolute;
      /* Above the list's buttons, whose labels sit on their own layer. */
      z-index: 2;
    }
    .map-pane.open {
      opacity: 1;
      pointer-events: auto;
    }
    .map-pane bb-map {
      inset: 0;
      position: absolute;
    }
    .search-area {
      left: 50%;
      position: absolute;
      top: 16px;
      transform: translateX(-50%);
    }
    .locate {
      background: var(--mat-sys-surface);
      left: 16px;
      position: absolute;
      top: 16px;
    }
    /* Centred without a transform, so nothing can shift it; round on
       purpose (a floating switch), and it only changes colour on hover. */
    .view-toggle {
      --mat-button-filled-container-shape: 999px;
      --mat-button-filled-hover-state-layer-opacity: 0;
      --mat-button-filled-focus-state-layer-opacity: 0;
      --mat-button-filled-pressed-state-layer-opacity: 0;
      bottom: 24px;
      box-shadow: var(--bb-shadow-md);
      left: 0;
      margin: 0 auto;
      padding: 0 22px;
      position: absolute;
      right: 0;
      transition: background-color 400ms var(--bb-ease);
      width: fit-content;
      z-index: 3;
    }
    .explore .view-toggle:not([disabled]):hover,
    .explore .view-toggle:not([disabled]):active {
      background-color: color-mix(in srgb, var(--mat-sys-primary) 78%, black);
      box-shadow: var(--bb-shadow-md);
      transform: none;
    }
    .visually-hidden {
      clip: rect(0 0 0 0);
      height: 1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
      width: 1px;
    }
  `,
})
export class ExplorePage {
  protected readonly store = inject(ExploreStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly geolocation = inject(GeolocationService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private readonly breakpoints = inject(BreakpointObserver);

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly wide = toSignal(
    this.breakpoints.observe(WIDE).pipe(map((s) => s.matches)),
    { initialValue: this.breakpoints.isMatched(WIDE) },
  );
  /** Phones: whether the map is showing over the list. */
  protected readonly mapOpen = signal(false);
  protected readonly locating = signal(false);

  // Optional queries: both are read before the view exists (first effect
  // run, initial map view), where a required query would throw.
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly mapPane = viewChild<ElementRef<HTMLElement>>('mapPane');

  /** Where the map should look; set on purpose, not by the user's panning. */
  protected readonly view = signal(this.viewFor(this.store.center()));
  /** Where the map actually is, after the user's panning. */
  protected readonly camera = signal<MapCamera | null>(null);

  private readonly radiusM = computed(
    () => this.store.filters().radiusKm * 1000,
  );
  protected readonly points = computed<MapPoint[]>(() =>
    this.store
      .items()
      .map((i) => ({ id: i.id, location: i.approximateLocation })),
  );
  protected readonly searchCircle = computed(() => ({
    center: this.store.center(),
    radiusM: this.radiusM(),
  }));
  protected readonly areaMoved = computed(() => {
    const camera = this.camera();
    return (
      camera !== null &&
      distanceM(camera.center, this.store.center()) >
        this.radiusM() * AREA_MOVE_SHARE
    );
  });

  constructor() {
    void this.store.start(filtersFromQuery(this.route.snapshot.queryParams));

    // Filters (never the point) go into the URL, so a search can be shared.
    effect(() => {
      const queryParams = filtersToQuery(this.store.filters());
      untracked(
        () =>
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams,
            queryParamsHandling: 'merge',
            replaceUrl: true,
          }),
      );
    });

    // A new radius: zoom so its circle fits.
    effect(() => {
      const radiusKm = this.store.filters().radiusKm;
      untracked(() =>
        this.view.set(this.viewFor(this.store.center(), radiusKm)),
      );
    });

    // A new search starts at the top of the list.
    effect(() => {
      if (this.store.status() === 'loading') {
        untracked(() => {
          const list = this.scroller()?.nativeElement;
          if (list) list.scrollTop = 0;
        });
      }
    });

    // Coming back from an item: where the list was (E10).
    afterNextRender(() => {
      const list = this.scroller()?.nativeElement;
      if (list) list.scrollTop = this.store.scrollTop();
    });
  }

  protected saveScroll(): void {
    const list = this.scroller()?.nativeElement;
    if (list) this.store.saveScroll(list.scrollTop);
  }

  /** A circle on the map: highlight its result and bring it into view. */
  protected pick(id: string): void {
    this.store.select(id);
    this.mapOpen.set(false);
    requestAnimationFrame(() =>
      this.document
        .getElementById(`result-${id}`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
  }

  protected searchThisArea(): void {
    const camera = this.camera();
    if (!camera) return;
    this.view.set({ center: camera.center, zoom: camera.zoom });
    void this.store.setArea(camera.center);
  }

  protected async useMyLocation(): Promise<void> {
    this.locating.set(true);
    try {
      const point = await this.geolocation.currentPosition();
      this.view.set(this.viewFor(point));
      await this.store.setArea(point);
    } catch (err) {
      const code = err instanceof GeolocationError ? err.code : 'unavailable';
      this.snackBar.open(
        this.transloco.translate(`geo.errors.${code}`),
        undefined,
        { duration: 6000 },
      );
    } finally {
      this.locating.set(false);
    }
  }

  /** Centred on `center`, zoomed so the search circle fits the map. */
  private viewFor(
    center: GeoPoint,
    radiusKm = this.store.filters().radiusKm,
  ): { center: GeoPoint; zoom: number } {
    return {
      center,
      zoom: zoomForRadius(radiusKm * 1000, center.lat, this.mapSizePx()),
    };
  }

  /** The map's shorter side; estimated from the window before it's laid out. */
  private mapSizePx(): number {
    const pane = this.mapPane()?.nativeElement;
    if (pane && pane.clientWidth > 0 && pane.clientHeight > 0) {
      return Math.min(pane.clientWidth, pane.clientHeight);
    }
    const win = this.document.defaultView;
    const width = win?.innerWidth ?? 1024;
    const height = win?.innerHeight ?? 768;
    return this.wide()
      ? Math.min(width - 280, height)
      : Math.min(width, height - 56);
  }
}
