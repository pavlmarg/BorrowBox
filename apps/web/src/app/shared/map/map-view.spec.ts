import type { FeatureCollection } from 'geojson';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import type { GeoPoint } from '@borrowbox/contracts';
import { AppConfigService } from '../../core/config/app-config';
import { CLUSTERS_LAYER, ITEMS_SOURCE, type MapPoint } from './map-layers';
import { MAP_LIBRE } from './map-loader';
import { MapView, type MapMode } from './map-view';

type Handler = (event: Record<string, unknown>) => void;

/** Just enough of MapLibre's Map to drive MapView. */
class FakeMap {
  static last: FakeMap;
  readonly sources = new Map<
    string,
    {
      options: unknown;
      setData: jest.Mock;
      getClusterExpansionZoom: () => Promise<number>;
      getClusterLeaves: () => Promise<Array<Record<string, unknown>>>;
    }
  >();
  readonly layers: Array<{ id: string; type: string }> = [];
  readonly handlers: Array<{ event: string; layer?: string; fn: Handler }> = [];
  readonly remove = jest.fn();
  readonly easeTo = jest.fn();
  readonly setLayoutProperty = jest.fn();
  readonly setPaintProperty = jest.fn();
  readonly setFilter = jest.fn();
  readonly touchZoomRotate = { disableRotation: jest.fn() };
  center = { lat: 37.9838, lng: 23.7275 };
  /** What the items source holds outside clusters, for the price tags. */
  unclustered: Array<Record<string, unknown>> = [];

  constructor(readonly options: Record<string, unknown>) {
    FakeMap.last = this;
  }
  addControl() {
    return this;
  }
  on(event: string, layerOrFn: string | Handler, fn?: Handler) {
    this.handlers.push(
      typeof layerOrFn === 'string'
        ? { event, layer: layerOrFn, fn: fn as Handler }
        : { event, fn: layerOrFn },
    );
    return this;
  }
  fire(event: string, payload: Record<string, unknown> = {}, layer?: string) {
    for (const h of this.handlers) {
      if (h.event === event && h.layer === layer) h.fn(payload);
    }
  }
  /** The zoom a clicked bubble separates at, and its items. */
  expansionZoom = 15;
  leaves: Array<Record<string, unknown>> = [];
  addSource(id: string, options: unknown) {
    this.sources.set(id, {
      options,
      setData: jest.fn(),
      getClusterExpansionZoom: () => Promise.resolve(this.expansionZoom),
      getClusterLeaves: () => Promise.resolve(this.leaves),
    });
  }
  getSource(id: string) {
    return this.sources.get(id);
  }
  addLayer(layer: { id: string; type: string }) {
    this.layers.push(layer);
  }
  getStyle() {
    return {
      layers: [
        { id: 'place', type: 'symbol', layout: { 'text-field': '{name}' } },
      ],
    };
  }
  getCenter() {
    return this.center;
  }
  getZoom() {
    return 13;
  }
  getCanvas() {
    return { style: {} as Record<string, string> };
  }
  querySourceFeatures() {
    return this.unclustered;
  }
  project() {
    return { x: 200, y: 300 };
  }
}

class FakeMarker {
  static last: FakeMarker;
  static all: FakeMarker[] = [];
  lngLat: [number, number] | null = null;
  readonly element?: HTMLElement;
  constructor(options: { element?: HTMLElement } = {}) {
    FakeMarker.last = this;
    FakeMarker.all.push(this);
    this.element = options.element;
  }
  on() {
    return this;
  }
  setLngLat(lngLat: [number, number]) {
    this.lngLat = lngLat;
    return this;
  }
  addTo() {
    return this;
  }
  remove() {
    this.lngLat = null;
  }
  getLngLat() {
    return this.lngLat;
  }
}

const fakeMapLibre = {
  Map: FakeMap,
  Marker: FakeMarker,
  NavigationControl: class {},
};

@Component({
  imports: [MapView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bb-map
      [mode]="mode"
      [points]="points()"
      [zoom]="zoom()"
      [hoverCard]="card"
      [(pin)]="pin"
      (pointSelected)="selected = $event"
    />
    <ng-template #card let-id
      ><span class="card">{{ id }}</span></ng-template
    >
  `,
})
class Host {
  mode: MapMode = 'browse';
  readonly points = signal<MapPoint[]>([]);
  readonly zoom = signal(13);
  readonly pin = signal<GeoPoint | null>(null);
  selected: string | null = null;
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
};

async function setup(options: { mode?: MapMode; styleUrl?: string | null }) {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'el' },
      }),
      {
        provide: AppConfigService,
        useValue: {
          load: () =>
            Promise.resolve({
              mapStyleUrl:
                options.styleUrl === undefined
                  ? 'https://tiles.example/style.json'
                  : options.styleUrl,
            }),
        },
      },
      { provide: MAP_LIBRE, useValue: () => Promise.resolve(fakeMapLibre) },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.mode = options.mode ?? 'browse';
  fixture.detectChanges();
  await settle();
  return { fixture, host: fixture.componentInstance };
}

const text = (el: HTMLElement) => el.textContent?.trim() ?? '';

describe('MapView', () => {
  it('says the map is unavailable without a configured style', async () => {
    const { fixture } = await setup({ styleUrl: null });
    fixture.detectChanges();
    expect(text(fixture.nativeElement)).toContain('map.unavailable');
  });

  it('says so too when the style itself fails to load', async () => {
    const { fixture } = await setup({});
    FakeMap.last.fire('error', { error: new Error('403') });
    fixture.detectChanges();
    expect(text(fixture.nativeElement)).toContain('map.unavailable');
  });

  it('clusters items and draws no symbol or pin layers', async () => {
    const { fixture } = await setup({});
    FakeMap.last.fire('load');
    fixture.detectChanges();

    expect(FakeMap.last.sources.get(ITEMS_SOURCE)?.options).toMatchObject({
      type: 'geojson',
      cluster: true,
    });
    expect(
      FakeMap.last.layers.some(
        (l) => l.type === 'symbol' && l.id !== 'bb-cluster-count',
      ),
    ).toBe(false);
    expect(text(fixture.nativeElement)).toBe('');
  });

  it('updates the items when the points change', async () => {
    const { fixture, host } = await setup({});
    FakeMap.last.fire('load');
    host.points.set([{ id: 'a', location: { lat: 38, lng: 23.7 } }]);
    fixture.detectChanges();
    await settle();

    const setData = FakeMap.last.sources.get(ITEMS_SOURCE)?.setData;
    const data = setData?.mock.lastCall?.[0] as FeatureCollection;
    expect(data.features.map((f) => f.id)).toEqual(['a']);
  });

  /** A tag for item `id` once the map settles, as MapLibre would place it. */
  function tagFor(id: string, label: string): HTMLElement {
    FakeMap.last.unclustered = [
      {
        properties: { id, label },
        geometry: { type: 'Point', coordinates: [23.7, 38] },
      },
    ];
    FakeMap.last.fire('moveend');
    const marker = FakeMarker.all.find((m) => m.element?.textContent === label);
    return marker?.element as HTMLElement;
  }

  it('shows each item as a price tag, and reports a clicked one', async () => {
    const { host } = await setup({});
    FakeMap.last.fire('load');
    const tag = tagFor('item-1', '€8');
    expect(tag.classList).toContain('bb-price-tag');
    tag.click();
    expect(host.selected).toBe('item-1');
  });

  it('highlights a tag while pointed at, and drops it once clustered', async () => {
    const { fixture } = await setup({});
    FakeMap.last.fire('load');
    const tag = tagFor('item-2', 'Free');
    tag.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    await settle();
    expect(tag.classList).toContain('highlight');

    const marker = FakeMarker.all.find((m) => m.element === tag) as FakeMarker;
    FakeMap.last.unclustered = [];
    FakeMap.last.fire('moveend');
    expect(marker.lngLat).toBeNull();
  });

  it('zooms into a bubble whose items separate further in', async () => {
    await setup({});
    FakeMap.last.fire('load');
    FakeMap.last.expansionZoom = 15;
    FakeMap.last.fire(
      'click',
      {
        features: [
          {
            properties: { cluster_id: 1 },
            geometry: { type: 'Point', coordinates: [23.7, 38] },
          },
        ],
        lngLat: { lng: 23.7, lat: 38 },
      },
      CLUSTERS_LAYER,
    );
    await settle();
    expect(FakeMap.last.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ zoom: 15 }),
    );
  });

  it('opens a bubble that never separates as its items’ cards', async () => {
    const { fixture } = await setup({});
    FakeMap.last.fire('load');
    FakeMap.last.expansionZoom = 18;
    FakeMap.last.leaves = [
      { properties: { id: 'a' } },
      { properties: { id: 'b' } },
    ];
    FakeMap.last.fire(
      'click',
      {
        features: [
          {
            properties: { cluster_id: 1 },
            geometry: { type: 'Point', coordinates: [23.7, 38] },
          },
        ],
        lngLat: { lng: 23.7, lat: 38 },
      },
      CLUSTERS_LAYER,
    );
    await settle();
    fixture.detectChanges();
    expect(FakeMap.last.easeTo).not.toHaveBeenCalled();
    const cards = fixture.nativeElement.querySelectorAll('.hover-card .card');
    expect([...cards].map((c: Element) => c.textContent)).toEqual(['a', 'b']);
  });

  it('has clickable clusters', async () => {
    await setup({});
    FakeMap.last.fire('load');
    expect(
      FakeMap.last.handlers.some(
        (h) => h.event === 'click' && h.layer === CLUSTERS_LAYER,
      ),
    ).toBe(true);
  });

  it('shows place names in the UI language', async () => {
    await setup({});
    FakeMap.last.fire('load');
    expect(FakeMap.last.setLayoutProperty).toHaveBeenCalledWith(
      'place',
      'text-field',
      ['coalesce', ['get', 'name:el'], ['get', 'name']],
    );
  });

  it('places the pin where the owner clicks', async () => {
    const { fixture, host } = await setup({ mode: 'pin' });
    FakeMap.last.fire('load');
    FakeMap.last.fire('click', { lngLat: { lat: 38.01, lng: 23.8 } });
    fixture.detectChanges();
    await settle();

    expect(host.pin()).toEqual({ lat: 38.01, lng: 23.8 });
    expect(FakeMarker.last.lngLat).toEqual([23.8, 38.01]);
  });

  it('moves when its zoom changes', async () => {
    const { fixture, host } = await setup({});
    FakeMap.last.fire('load');
    host.zoom.set(15);
    fixture.detectChanges();
    await settle();
    expect(FakeMap.last.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({ zoom: 15 }),
    );
  });

  it('removes the map when destroyed', async () => {
    const { fixture } = await setup({});
    fixture.destroy();
    expect(FakeMap.last.remove).toHaveBeenCalled();
  });
});
