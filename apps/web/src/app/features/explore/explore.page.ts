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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { GeoPoint } from '@borrowbox/contracts';
import { map } from 'rxjs';
import { NavIcon } from '../../core/layout/nav-icon';
import {
  GeolocationError,
  GeolocationService,
} from '../../shared/geo/geolocation';
import {
  distanceM,
  radiusCoveringView,
  zoomForRadius,
} from '../../shared/map/geo';
import type { MapPoint } from '../../shared/map/map-layers';
import { MapView, type MapCamera } from '../../shared/map/map-view';
import { filtersFromQuery, filtersToQuery } from './explore-query';
import { CategoryRail } from './category-rail';
import { ExploreFilters } from './explore-filters';
import { FeaturedCarousel } from './featured-carousel';
import { ExploreStore } from './explore.store';
import type { PublicItemSummaryResponse } from '../../api/models';
import { categoryColor } from '../../shared/catalog/category-colors';
import { ResultRow } from '../../shared/catalog/result-row';
import { EurPipe } from '../../shared/format/eur.pipe';
import { formatCents } from '../../shared/format/money';
import { cardRate } from '../../shared/format/pricing';
import { LanguageService } from '../../core/i18n/language';
import { LendRail } from './lend-rail';
import { SearchBar } from './search-bar';

/** Same breakpoint as the app shell's top-bar navigation. */
const WIDE = '(min-width: 960px)';
/** Room beside the column for the category and lending rails. */
const RAILS = '(min-width: 1400px)';
/** "Search this area" appears once the map moved this share of the radius. */
const AREA_MOVE_SHARE = 0.2;
/** …or once it zoomed in or out by this much. */
const AREA_ZOOM_CHANGE = 0.5;
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
    FeaturedCarousel,
    ResultRow,
    CategoryRail,
    LendRail,
    RouterLink,
    EurPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="explore" *transloco="let t" [class.wide]="wide()">
      <section
        class="list-pane"
        #scroller
        (scroll)="saveScroll()"
        [class.with-rails]="rails()"
        [attr.aria-label]="t('explore.results')"
      >
        @if (rails()) {
          <bb-category-rail class="rail left" />
        }
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

        <div class="results">
          <div class="column">
            @if (!store.filters().q && store.featured().length > 0) {
              <bb-featured-carousel [items]="store.featured()" />
            }
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
        @if (rails()) {
          <bb-lend-rail class="rail right" />
        }
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
          [hoverCard]="mapCard"
          (cameraChange)="camera.set($event)"
          (pointSelected)="openItem($event)"
        />
        <ng-template #mapCard let-id>
          @if (itemsById().get(id); as item) {
            <a
              class="map-card"
              [routerLink]="['/items', item.id]"
              [style.--cat]="colorOf(item.category)"
            >
              <span class="map-card-photo">
                @if (item.coverPhoto; as cover) {
                  <img [src]="cover.small" alt="" />
                }
              </span>
              <span class="map-card-text">
                <span class="map-card-category">{{
                  t('catalog.categories.' + item.category)
                }}</span>
                <span class="map-card-title">{{ item.title }}</span>
                @if (rateOf(item); as r) {
                  <span class="map-card-price">
                    @if (r.free) {
                      {{ t('catalog.free') }}
                    } @else {
                      <strong>{{ r.rate.cents | eur }}</strong
                      >{{ t('catalog.perUnit.' + r.rate.unit) }}
                    }
                  </span>
                }
              </span>
            </a>
          }
        </ng-template>
        @if (areaMoved()) {
          <button
            mat-flat-button
            type="button"
            class="floating search-area"
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
        class="floating view-toggle"
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
      /* Below the app's top bar. */
      height: calc(100dvh - 64px);
      position: relative;
    }

    /* The list: the whole area, its content in a centred column. */
    /* The whole pane scrolls as one page; the search head stays on top. */
    .list-pane {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-y: auto;
    }
    .head {
      background: var(--bb-page-bg);
      border-bottom: 1px solid rgb(16 58 99 / 0.08);
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
    }
    .head,
    .column {
      box-sizing: border-box;
      margin: 0 auto;
      max-width: 1000px;
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
      flex: none;
    }
    .column {
      /* Room for the floating Map/List button. */
      padding-bottom: 88px;
    }
    /* Wide screens: a rail on each side of the column, the page's whole
       length; they scroll away with the results. */
    .list-pane.with-rails {
      box-sizing: border-box;
      column-gap: 40px;
      display: grid;
      /* The rails keep at least 220 px; the column gives way first. */
      grid-template-columns: minmax(220px, 1fr) minmax(0, 1000px) minmax(
          220px,
          1fr
        );
      grid-template-rows: auto 1fr;
      padding: 0 32px;
    }
    .with-rails .head {
      grid-column: 2;
      grid-row: 1;
    }
    .with-rails .results {
      grid-column: 2;
      grid-row: 2;
    }
    .rail {
      box-sizing: border-box;
      grid-row: 1 / -1;
      max-width: 280px;
      padding: 24px 0 48px;
      width: 100%;
    }
    .rail.left {
      grid-column: 1;
      justify-self: end;
    }
    .rail.right {
      grid-column: 3;
      justify-self: start;
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
      height: 120px;
      width: 120px;
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
    /* The two floating buttons: round on purpose, centred without a
       transform (so the lift on hover can't shift them sideways); they
       rise a little and fade their colour on hover. */
    .floating {
      --mat-button-filled-container-shape: 999px;
      --mat-button-filled-hover-state-layer-opacity: 0;
      --mat-button-filled-focus-state-layer-opacity: 0;
      --mat-button-filled-pressed-state-layer-opacity: 0;
      box-shadow: var(--bb-shadow-md);
      left: 0;
      margin: 0 auto;
      position: absolute;
      right: 0;
      transition:
        background-color 400ms var(--bb-ease),
        transform var(--bb-medium) var(--bb-ease),
        box-shadow var(--bb-medium) var(--bb-ease);
      width: fit-content;
      z-index: 3;
    }
    .explore .floating:not([disabled]):hover {
      box-shadow:
        0 8px 18px rgb(16 58 99 / 0.18),
        0 16px 36px rgb(16 58 99 / 0.1);
      transform: translateY(-2px);
    }
    .explore .floating:not([disabled]):active {
      transform: translateY(0);
    }
    .view-toggle {
      bottom: 24px;
      padding: 0 22px;
    }
    .explore .view-toggle:not([disabled]):hover {
      background-color: color-mix(in srgb, var(--mat-sys-primary) 78%, black);
    }
    .search-area {
      --mat-button-filled-container-color: #fff;
      --mat-button-filled-label-text-color: var(--bb-sky-700);
      padding: 0 30px;
      top: 16px;
    }
    .explore .search-area:not([disabled]):hover {
      background-color: var(--bb-sky-50);
    }
    .locate {
      background: var(--mat-sys-surface);
      left: 16px;
      position: absolute;
      top: 16px;
    }
    /* The card above a hovered circle on the map: the item at a glance,
       linking to its page. */
    .map-card {
      align-items: center;
      background: #fff;
      box-shadow: var(--bb-shadow-md);
      color: var(--mat-sys-on-surface);
      display: flex;
      gap: 10px;
      padding: 8px 12px 8px 8px;
      text-decoration: none;
      width: 260px;
    }
    .map-card-photo {
      background: var(--bb-sky-100);
      flex: none;
      height: 64px;
      overflow: hidden;
      width: 64px;
    }
    .map-card-photo img {
      display: block;
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
    .map-card-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .map-card-category {
      color: var(--cat);
      font: var(--mat-sys-label-small);
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }
    .map-card-title {
      font: var(--mat-sys-title-small);
      overflow: hidden;
      text-decoration: underline;
      text-overflow: ellipsis;
      text-underline-offset: 3px;
      transition: color var(--bb-fast) var(--bb-ease);
      white-space: nowrap;
    }
    .map-card:hover .map-card-title {
      color: var(--cat);
    }
    .map-card-price {
      font: var(--mat-sys-body-medium);
    }
    .map-card:focus-visible {
      outline: 3px solid var(--bb-sky-300);
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
  private readonly language = inject(LanguageService);
  private readonly document = inject(DOCUMENT);
  private readonly breakpoints = inject(BreakpointObserver);

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly wide = toSignal(
    this.breakpoints.observe(WIDE).pipe(map((s) => s.matches)),
    { initialValue: this.breakpoints.isMatched(WIDE) },
  );
  protected readonly rails = toSignal(
    this.breakpoints.observe(RAILS).pipe(map((s) => s.matches)),
    { initialValue: this.breakpoints.isMatched(RAILS) },
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
  /** Set by "Search this area": its radius change mustn't re-zoom the map. */
  private keepView = false;
  /** Where the map actually is, after the user's panning. */
  protected readonly camera = signal<MapCamera | null>(null);

  /** The radius alone: unchanged by other filters (a computed compares values). */
  private readonly radiusKm = computed(() => this.store.filters().radiusKm);
  private readonly radiusM = computed(() => this.radiusKm() * 1000);
  /** For the map's hover card. */
  protected readonly itemsById = computed(
    () => new Map(this.store.items().map((i) => [i.id, i])),
  );
  protected readonly colorOf = categoryColor;
  protected rateOf(item: PublicItemSummaryResponse) {
    return cardRate(item.pricing);
  }

  /** A map tag: the card's rate without its unit, e.g. "€8", or "Free". */
  private tagLabel(item: PublicItemSummaryResponse, locale: string): string {
    const r = cardRate(item.pricing);
    return r.free
      ? this.transloco.translate('catalog.free')
      : formatCents(r.rate.cents, locale);
  }
  protected readonly points = computed<MapPoint[]>(() => {
    const locale = this.language.formatLocale();
    // Read so the labels follow a language switch.
    this.language.current();
    return this.store.items().map((i) => ({
      id: i.id,
      location: i.approximateLocation,
      label: this.tagLabel(i, locale),
    }));
  });
  /** The map moved or zoomed away from the area last searched. */
  protected readonly areaMoved = computed(() => {
    const camera = this.camera();
    if (camera === null) return false;
    return (
      distanceM(camera.center, this.store.center()) >
        this.radiusM() * AREA_MOVE_SHARE ||
      Math.abs(camera.zoom - this.view().zoom) > AREA_ZOOM_CHANGE
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
    // Reads the radius through a computed, so other filter changes (or the
    // same radius again) don't re-zoom the map.
    effect(() => {
      const radiusKm = this.radiusKm();
      untracked(() => {
        if (this.keepView) {
          this.keepView = false;
          return;
        }
        this.view.set(this.viewFor(this.store.center(), radiusKm));
      });
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
  /** A price tag on the map: straight to its item's page. */
  protected openItem(id: string): void {
    void this.router.navigate(['/items', id]);
  }

  /**
   * Searches everything on screen: from the map's centre with the smallest
   * allowed radius (ADR-0007's fixed steps) that contains the whole view.
   * The map stays where the user put it.
   */
  protected searchThisArea(): void {
    const camera = this.camera();
    const pane = this.mapPane()?.nativeElement;
    if (!camera || !pane) return;
    const radiusKm = radiusCoveringView(
      camera.center.lat,
      camera.zoom,
      pane.clientWidth,
      pane.clientHeight,
    );
    if (radiusKm !== this.store.filters().radiusKm) this.keepView = true;
    this.view.set({ center: camera.center, zoom: camera.zoom });
    void this.store.searchArea(camera.center, radiusKm);
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
    return Math.min(width, height - 64);
  }
}
