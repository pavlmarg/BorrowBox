import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
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
  CLUSTER_MAX_ZOOM,
  CLUSTERS_LAYER,
  ITEM_AREAS_LAYER,
  ITEMS_SOURCE,
  SEARCH_SOURCE,
  SKY_700,
  areaLayers,
  browseLayers,
  circleData,
  itemColour,
  itemsData,
  searchLayers,
  styleLabelFont,
  type MapPoint,
} from './map-layers';
import { MAP_LIBRE, type MapLibre } from './map-loader';

/**
 * - `browse`: items at their public points, clustered when zoomed out,
 *   circles when zoomed in (Explore).
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
 * The one map component (ADR-0008). Everyone but an item's owner only ever
 * sees circles around public points (ADR-0007). Without a configured style
 * or WebGL it says the map is unavailable and the page carries on.
 *
 * Give the host a height: `bb-map { height: 360px }`.
 */
@Component({
  selector: 'bb-map',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #canvas class="canvas"></div>
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
  /** Where the map looks; changing it moves the map. */
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

  /** After every move, by the user or the map itself. */
  readonly cameraChange = output<MapCamera>();
  readonly pointSelected = output<string>();

  protected readonly state = signal<MapState>('loading');

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
      this.map?.remove();
    });

    effect(() => {
      const data = itemsData(this.points());
      if (this.drawn()) this.source(ITEMS_SOURCE)?.setData(data);
    });
    effect(() => {
      const colour = itemColour(this.selectedId());
      if (!this.drawn() || this.mode() !== 'browse') return;
      this.map?.setPaintProperty(ITEM_AREAS_LAYER, 'circle-color', colour);
      this.map?.setPaintProperty(
        ITEM_AREAS_LAYER,
        'circle-stroke-color',
        colour,
      );
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
      const map = this.map;
      if (!this.drawn() || !map) return;
      const { lat, lng } = map.getCenter();
      if (distanceM(center, { lat, lng }) > 1) {
        map.jumpTo({ center: [center.lng, center.lat] });
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
      for (const layer of browseLayers(this.selectedId(), font)) {
        map.addLayer(layer);
      }

      map.on('click', CLUSTERS_LAYER, (event) => void this.zoomInto(event));
      map.on('click', ITEM_AREAS_LAYER, (event) => {
        const id = event.features?.[0]?.properties?.['id'];
        if (typeof id === 'string') this.pointSelected.emit(id);
      });
      for (const layer of [CLUSTERS_LAYER, ITEM_AREAS_LAYER]) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
        });
      }
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

  private async zoomInto(event: MapLayerMouseEvent): Promise<void> {
    const feature = event.features?.[0];
    const clusterId = feature?.properties?.['cluster_id'];
    const source = this.source(ITEMS_SOURCE);
    if (!source || typeof clusterId !== 'number' || !this.map) return;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    this.map.easeTo({ center: event.lngLat, zoom });
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
