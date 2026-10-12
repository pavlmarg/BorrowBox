import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  TemplateRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { LOCATION_OFFSET_MAX_M, type GeoPoint } from '@borrowbox/contracts';
import type {
  GeoJSONSource,
  MapLayerMouseEvent,
  MapLibreMap,
  Marker,
} from 'maplibre-gl';
import { AppConfigService } from '../../core/config/app-config';
import { LanguageService, isLanguage } from '../../core/i18n/language';
import { DEFAULT_CENTER, distanceM } from './geo';
import { labelUpdates } from './map-labels';
import {
  AREA_SOURCE,
  CLUSTER_CARDS_MAX,
  CLUSTER_MAX_ZOOM,
  CLUSTERS_LAYER,
  ITEM_AREA_LAYER,
  ITEMS_SOURCE,
  SEARCH_SOURCE,
  SKY_700,
  areaFilter,
  areaLayers,
  browseLayers,
  circleData,
  itemsData,
  searchLayers,
  styleLabelFont,
  type MapPoint,
} from './map-layers';
import { MAP_LIBRE, type MapLibre } from './map-loader';

/**
 * - `browse`: items at their public points, clustered when zoomed out,
 *   price tags when zoomed in, the highlighted one with its area (Explore,
 *   ADR-0014).
 * - `area`: one approximate area (item page).
 * - `pin`: the owner places their own item's exact point, and sees the
 *   approximate area others get (listing wizard).
 */
export type MapMode = 'browse' | 'area' | 'pin';

export interface MapCamera {
  center: GeoPoint;
  zoom: number;
}

export interface SearchCircle {
  center: GeoPoint;
  radiusM: number;
}

type MapState = 'loading' | 'ready' | 'unavailable';

/**
 * The cards showing and where they point to, in map pixels: one item's
 * under the pointer (`id`), or an opened bubble's items (`id` null).
 */
interface Hovered {
  id: string | null;
  ids: string[];
  x: number;
  y: number;
  /** Below the tag: too close to the top for the card above it. */
  below: boolean;
}

/** Room the card needs above the tag; with less, it goes below. */
const CARD_ROOM_PX = 150;
/** A bubble's largest radius: an opened bubble's cards sit above it. */
const BUBBLE_RADIUS_PX = 26;
/** A price tag's height, its pointer included: the card sits above it. */
const TAG_HEIGHT_PX = 34;

/** A price tag on the map and what it shows. */
interface Tag {
  marker: Marker;
  element: HTMLElement;
  label: string;
}
/** How long the card waits for the pointer to come back before closing. */
const CARD_CLOSE_MS = 200;

/**
 * The one map component (ADR-0008). Everyone but an item's owner only ever
 * sees public points (ADR-0007): areas, or Explore's price tags (ADR-0014). Without a configured style
 * or WebGL it says the map is unavailable and the page carries on.
 *
 * Give the host a height: `bb-map { height: 360px }`.
 */
@Component({
  selector: 'bb-map',
  imports: [TranslocoPipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #canvas class="canvas"></div>
    @if (hovered(); as h) {
      @if (hoverCard(); as card) {
        <div
          class="hover-card"
          [class.below]="h.below"
          [style.left.px]="h.x"
          [style.top.px]="h.y"
          (mouseenter)="keepCard()"
          (mouseleave)="closeCardSoon()"
        >
          <div class="cards">
            @for (id of h.ids; track id) {
              <ng-container
                *ngTemplateOutlet="card; context: { $implicit: id }"
              />
            }
          </div>
        </div>
      }
    }
    @if (state() !== 'ready') {
      <p class="overlay" role="status">
        {{
          (state() === 'loading' ? 'map.loading' : 'map.unavailable')
            | transloco
        }}
      </p>
    }
  `,
  styles: `
    :host {
      border-radius: var(--bb-radius);
      display: block;
      overflow: hidden;
      position: relative;
    }
    .canvas {
      inset: 0;
      position: absolute;
    }
    /* Above (or below) the hovered tag. Its transparent padding bridges
       the gap, so the pointer can reach the card without closing it. */
    .hover-card {
      animation: bb-card-in 220ms var(--bb-ease) both;
      padding-bottom: 10px;
      position: absolute;
      transform: translate(-50%, -100%);
      z-index: 3;
    }
    .hover-card.below {
      padding: 10px 0 0;
      transform: translate(-50%, 0);
    }
    .cards {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    @keyframes bb-card-in {
      from {
        opacity: 0;
        margin-top: 6px;
      }
    }
    .overlay {
      align-items: center;
      background: var(--bb-sky-50);
      color: var(--mat-sys-on-surface-variant);
      display: flex;
      font: var(--mat-sys-body-medium);
      inset: 0;
      justify-content: center;
      margin: 0;
      padding: 16px;
      position: absolute;
      text-align: center;
    }
  `,
})
export class MapView {
  readonly mode = input.required<MapMode>();
  /** Where the map looks; changing it (or `zoom`) moves the map. */
  readonly center = input<GeoPoint>(DEFAULT_CENTER);
  readonly zoom = input(13);
  /** `browse`: items at their public points. */
  readonly points = input<readonly MapPoint[]>([]);
  readonly selectedId = input<string | null>(null);
  /** `browse`: the search radius, outlined. */
  readonly searchCircle = input<SearchCircle | null>(null);
  /** `area` and `pin`: a public point, drawn as the offset-radius circle. */
  readonly area = input<GeoPoint | null>(null);
  /** `pin`: the exact point, set by clicking the map or dragging the pin. */
  readonly pin = model<GeoPoint | null>(null);
  /**
   * `browse`: shown above an item's price tag while the pointer is on it
   * (or on the card), given the item's id. Pointer devices only.
   */
  readonly hoverCard = input<TemplateRef<{ $implicit: string }> | null>(null);

  /** After every move, by the user or the map itself. */
  readonly cameraChange = output<MapCamera>();
  readonly pointSelected = output<string>();

  protected readonly state = signal<MapState>('loading');
  protected readonly hovered = signal<Hovered | null>(null);
  /**
   * The item in orange with its area drawn: the one under the pointer,
   * otherwise the one picked in the list (ADR-0014).
   */
  private readonly highlightId = computed(
    () => this.hovered()?.id ?? this.selectedId(),
  );
  private closeTimer?: ReturnType<typeof setTimeout>;
  /** `browse`: the price tags on the map, by item id. */
  private readonly tags = new Map<string, Tag>();

  private readonly canvas =
    viewChild.required<ElementRef<HTMLElement>>('canvas');
  private readonly config = inject(AppConfigService);
  private readonly loadMapLibre = inject(MAP_LIBRE);
  private readonly language = inject(LanguageService);

  private map?: MapLibreMap;
  private marker?: Marker;
  private destroyed = false;
  /** True once the style is loaded and our sources and layers exist. */
  private readonly drawn = signal(false);

  constructor() {
    afterNextRender(() => void this.create());
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      clearTimeout(this.closeTimer);
      this.tags.clear();
      this.map?.remove();
    });

    effect(() => {
      const data = itemsData(this.points());
      if (this.drawn()) this.source(ITEMS_SOURCE)?.setData(data);
    });
    effect(() => {
      const id = this.highlightId();
      if (!this.drawn() || this.mode() !== 'browse') return;
      for (const [tagId, tag] of this.tags) {
        tag.element.classList.toggle('highlight', tagId === id);
      }
      this.map?.setFilter(ITEM_AREA_LAYER, areaFilter(id));
    });
    effect(() => {
      const circle = this.searchCircle();
      const data = circleData(circle?.center ?? null, circle?.radiusM ?? 0);
      if (this.drawn()) this.source(SEARCH_SOURCE)?.setData(data);
    });
    effect(() => {
      const data = circleData(this.area(), LOCATION_OFFSET_MAX_M);
      if (this.drawn()) this.source(AREA_SOURCE)?.setData(data);
    });
    effect(() => {
      const pin = this.pin();
      if (this.drawn()) this.placeMarker(pin);
    });
    effect(() => {
      const center = this.center();
      const zoom = this.zoom();
      const map = this.map;
      if (!this.drawn() || !map) return;
      const { lat, lng } = map.getCenter();
      if (
        distanceM(center, { lat, lng }) > 1 ||
        Math.abs(map.getZoom() - zoom) > 0.01
      ) {
        // Not marked essential, so MapLibre skips the animation for people
        // who prefer reduced motion.
        map.easeTo({ center: [center.lng, center.lat], zoom, duration: 400 });
      }
    });
    effect(() => {
      const lang = this.language.current();
      if (this.drawn()) this.localiseLabels(lang);
    });
  }

  private async create(): Promise<void> {
    const { mapStyleUrl } = await this.config.load();
    if (!mapStyleUrl) return this.state.set('unavailable');

    let maplibre: MapLibre;
    try {
      maplibre = await this.loadMapLibre();
    } catch {
      return this.state.set('unavailable');
    }
    if (this.destroyed) return;

    const center = this.center();
    let map: MapLibreMap;
    try {
      map = new maplibre.Map({
        container: this.canvas().nativeElement,
        style: mapStyleUrl,
        center: [center.lng, center.lat],
        zoom: this.zoom(),
        // Explore: no further than the clusters go (see CLUSTER_MAX_ZOOM).
        ...(this.mode() === 'browse' ? { maxZoom: CLUSTER_MAX_ZOOM } : {}),
        attributionControl: { compact: true },
        // A flat, north-up map: nothing to gain from rotating it.
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch {
      // No WebGL.
      return this.state.set('unavailable');
    }
    this.map = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(
      new maplibre.NavigationControl({ showCompass: false }),
      'top-right',
    );

    map.on('error', (event) => {
      // A style that can't load (bad key, provider down) leaves no map. Tile
      // errors carry a sourceId and only cost a patch of the map.
      if (!this.drawn() && !('sourceId' in event)) {
        this.state.set('unavailable');
      }
    });
    map.on('load', () => {
      this.draw(maplibre, map);
      this.localiseLabels(this.language.current());
      this.drawn.set(true);
      this.state.set('ready');
    });
    map.on('moveend', () => {
      const { lat, lng } = map.getCenter();
      this.cameraChange.emit({ center: { lat, lng }, zoom: map.getZoom() });
    });
  }

  private draw(maplibre: MapLibre, map: MapLibreMap): void {
    const mode = this.mode();
    if (mode === 'browse') {
      const circle = this.searchCircle();
      map.addSource(SEARCH_SOURCE, {
        type: 'geojson',
        data: circleData(circle?.center ?? null, circle?.radiusM ?? 0),
      });
      for (const layer of searchLayers()) map.addLayer(layer);

      map.addSource(ITEMS_SOURCE, {
        type: 'geojson',
        data: itemsData(this.points()),
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: 50,
      });
      const font = styleLabelFont(map.getStyle().layers ?? []);
      for (const layer of browseLayers(this.highlightId(), font)) {
        map.addLayer(layer);
      }

      map.on('click', CLUSTERS_LAYER, (event) => void this.zoomInto(event));
      map.on('mouseenter', CLUSTERS_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', CLUSTERS_LAYER, () => {
        map.getCanvas().style.cursor = '';
      });
      // The tags follow the clusters: refreshed once the map settles or the
      // items change.
      const sync = () => this.syncTags(maplibre, map);
      map.on('moveend', sync);
      map.on('sourcedata', (event) => {
        if (event.sourceId === ITEMS_SOURCE && event.isSourceLoaded) sync();
      });
      // The card would drift from its tag: it goes until the next hover.
      map.on('movestart', () => this.hovered.set(null));
      return;
    }

    map.addSource(AREA_SOURCE, {
      type: 'geojson',
      data: circleData(this.area(), LOCATION_OFFSET_MAX_M),
    });
    for (const layer of areaLayers()) map.addLayer(layer);

    if (mode === 'pin') {
      this.marker = new maplibre.Marker({ draggable: true, color: SKY_700 });
      this.marker.on('dragend', () => {
        const lngLat = this.marker?.getLngLat();
        if (lngLat) this.pin.set({ lat: lngLat.lat, lng: lngLat.lng });
      });
      this.placeMarker(this.pin());
      map.on('click', ({ lngLat }) =>
        this.pin.set({ lat: lngLat.lat, lng: lngLat.lng }),
      );
    }
  }

  /**
   * A price tag for every item not in a cluster bubble, at its public point
   * (the tag's pointer marks it). Tags out of view or now clustered go.
   */
  private syncTags(maplibre: MapLibre, map: MapLibreMap): void {
    const seen = new Set<string>();
    const features = map.querySourceFeatures(ITEMS_SOURCE, {
      filter: ['!', ['has', 'point_count']],
    });
    for (const feature of features) {
      const id = feature.properties?.['id'];
      const label = String(feature.properties?.['label'] ?? '');
      if (
        typeof id !== 'string' ||
        seen.has(id) ||
        feature.geometry.type !== 'Point'
      ) {
        continue;
      }
      seen.add(id);
      const [lng, lat] = feature.geometry.coordinates;
      const existing = this.tags.get(id);
      if (existing) {
        existing.marker.setLngLat([lng, lat]);
        if (existing.label !== label) {
          existing.element.textContent = label;
          existing.label = label;
        }
        continue;
      }
      const element = this.tagElement(map, id, label);
      const marker = new maplibre.Marker({ element, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);
      this.tags.set(id, { marker, element, label });
    }
    for (const [id, tag] of this.tags) {
      if (!seen.has(id)) {
        tag.marker.remove();
        this.tags.delete(id);
      }
    }
  }

  /**
   * A price tag: points at the item, highlights it and shows its card while
   * pointed at, and reports a click. Styled in styles.scss (`.bb-price-tag`):
   * MapLibre places it outside this component's view.
   */
  private tagElement(map: MapLibreMap, id: string, label: string): HTMLElement {
    const element = document.createElement('div');
    element.className = 'bb-price-tag';
    element.textContent = label;
    element.classList.toggle('highlight', this.highlightId() === id);
    element.addEventListener('mouseenter', () => this.showCard(map, id));
    element.addEventListener('mouseleave', () => this.closeCardSoon());
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      this.pointSelected.emit(id);
    });
    return element;
  }

  /** The item under the pointer: highlighted, with its card above its tag. */
  private showCard(map: MapLibreMap, id: string): void {
    this.keepCard();
    const tag = this.tags.get(id);
    if (!tag || this.hovered()?.id === id) return;
    const point = map.project(tag.marker.getLngLat());
    const below = point.y - TAG_HEIGHT_PX < CARD_ROOM_PX;
    this.hovered.set({
      id,
      ids: [id],
      x: point.x,
      y: below ? point.y + 4 : point.y - TAG_HEIGHT_PX,
      below,
    });
  }

  protected keepCard(): void {
    clearTimeout(this.closeTimer);
  }

  protected closeCardSoon(): void {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.hovered.set(null), CARD_CLOSE_MS);
  }

  /**
   * A bubble: zooms in to where its items separate, or, if they never do
   * here (one place, or the map's closest zoom), shows their cards.
   */
  private async zoomInto(event: MapLayerMouseEvent): Promise<void> {
    const feature = event.features?.[0];
    const clusterId = feature?.properties?.['cluster_id'];
    const source = this.source(ITEMS_SOURCE);
    const map = this.map;
    if (!source || typeof clusterId !== 'number' || !map) return;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    if (zoom <= CLUSTER_MAX_ZOOM) {
      map.easeTo({ center: event.lngLat, zoom });
      return;
    }
    const leaves = await source.getClusterLeaves(
      clusterId,
      CLUSTER_CARDS_MAX,
      0,
    );
    const ids = leaves
      .map((leaf) => leaf.properties?.['id'])
      .filter((id): id is string => typeof id === 'string');
    if (ids.length === 0 || feature?.geometry.type !== 'Point') return;
    const [lng, lat] = feature.geometry.coordinates;
    const point = map.project([lng, lat]);
    const below = point.y - BUBBLE_RADIUS_PX < CARD_ROOM_PX;
    this.keepCard();
    this.hovered.set({
      id: null,
      ids,
      x: point.x,
      y: below ? point.y + BUBBLE_RADIUS_PX : point.y - BUBBLE_RADIUS_PX,
      below,
    });
  }

  private placeMarker(pin: GeoPoint | null): void {
    if (!this.marker || !this.map) return;
    if (pin) {
      this.marker.setLngLat([pin.lng, pin.lat]).addTo(this.map);
    } else {
      this.marker.remove();
    }
  }

  private localiseLabels(lang: string): void {
    const map = this.map;
    if (!map || !isLanguage(lang)) return;
    for (const { layerId, textField } of labelUpdates(
      map.getStyle().layers ?? [],
      lang,
    )) {
      map.setLayoutProperty(layerId, 'text-field', textField);
    }
  }

  private source(id: string): GeoJSONSource | undefined {
    return this.map?.getSource<GeoJSONSource>(id);
  }
}
