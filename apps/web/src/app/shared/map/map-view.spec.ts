import type { FeatureCollection } from 'geojson';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco } from '@jsverse/transloco';
import type { GeoPoint } from '@borrowbox/contracts';
import { AppConfigService } from '../../core/config/app-config';
import {
  CLUSTERS_LAYER,
  ITEM_AREAS_LAYER,
  ITEMS_SOURCE,
  type MapPoint,
} from './map-layers';
import { MAP_LIBRE } from './map-loader';
import { MapView, type MapMode } from './map-view';

type Handler = (event: Record<string, unknown>) => void;

/** Just enough of MapLibre's Map to drive MapView. */
class FakeMap {
  static last: FakeMap;
  readonly sources = new Map<
    string,
    { options: unknown; setData: jest.Mock }
  >();
  readonly layers: Array<{ id: string; type: string }> = [];
  readonly handlers: Array<{ event: string; layer?: string; fn: Handler }> = [];
  readonly remove = jest.fn();
  readonly jumpTo = jest.fn();
  readonly setLayoutProperty = jest.fn();
  readonly setPaintProperty = jest.fn();
  readonly touchZoomRotate = { disableRotation: jest.fn() };
  center = { lat: 37.9838, lng: 23.7275 };

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
  addSource(id: string, options: unknown) {
    this.sources.set(id, { options, setData: jest.fn() });
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
}

class FakeMarker {
  static last: FakeMarker;
  lngLat: [number, number] | null = null;
  constructor() {
    FakeMarker.last = this;
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
    return null;
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
      [(pin)]="pin"
      (pointSelected)="selected = $event"
    />
  `,
})
class Host {
  mode: MapMode = 'browse';
  readonly points = signal<MapPoint[]>([]);
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

  it('clusters items and draws them as circles, never pins', async () => {
    const { fixture } = await setup({});
    FakeMap.last.fire('load');
    fixture.detectChanges();

    expect(FakeMap.last.sources.get(ITEMS_SOURCE)?.options).toMatchObject({
      type: 'geojson',
      cluster: true,
    });
    const items = FakeMap.last.layers.find((l) => l.id === ITEM_AREAS_LAYER);
    expect(items?.type).toBe('circle');
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

  it('reports a clicked item', async () => {
    const { host } = await setup({});
    FakeMap.last.fire('load');
    FakeMap.last.fire(
      'click',
      { features: [{ properties: { id: 'item-1' } }] },
      ITEM_AREAS_LAYER,
    );
    expect(host.selected).toBe('item-1');
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

  it('removes the map when destroyed', async () => {
    const { fixture } = await setup({});
    fixture.destroy();
    expect(FakeMap.last.remove).toHaveBeenCalled();
  });
});
