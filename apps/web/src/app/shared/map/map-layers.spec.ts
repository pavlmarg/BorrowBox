import type { Polygon } from 'geojson';
import { LOCATION_OFFSET_MAX_M } from '@borrowbox/contracts';
import { DEFAULT_CENTER, distanceM } from './geo';
import {
  browseLayers,
  circleData,
  CLUSTER_COUNT_LAYER,
  ITEM_AREA_LAYER,
  areaFilter,
  itemsData,
  styleLabelFont,
} from './map-layers';

describe('itemsData', () => {
  it('puts each item at its public point with its circle size', () => {
    const data = itemsData([{ id: 'a', location: DEFAULT_CENTER }]);
    const [feature] = data.features;
    expect(feature.geometry).toEqual({
      type: 'Point',
      coordinates: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
    });
    expect(feature.properties).toMatchObject({ id: 'a' });
    expect(feature.properties?.['r0']).toBeGreaterThan(0);
  });
});

describe('circleData', () => {
  it('draws the offset radius around the public point', () => {
    const data = circleData(DEFAULT_CENTER, LOCATION_OFFSET_MAX_M);
    const ring = (data.features[0].geometry as Polygon).coordinates[0];
    const [lng, lat] = ring[10];
    expect(distanceM(DEFAULT_CENTER, { lat, lng })).toBeCloseTo(300, 3);
  });

  it('is empty without a centre', () => {
    expect(circleData(null, 300).features).toEqual([]);
  });
});

describe('browseLayers', () => {
  it('draws no item symbols or pins: items are HTML price tags', () => {
    const layers = browseLayers(null, null);
    expect(layers.some((l) => l.type === 'symbol')).toBe(false);
  });

  it('draws the highlighted item’s area, and no other', () => {
    const ids = browseLayers('a', null).map((l) => l.id);
    expect(ids).toContain(ITEM_AREA_LAYER);
    expect(JSON.stringify(areaFilter('a'))).toContain('"a"');
    // Without a highlight, the filter matches no item.
    expect(JSON.stringify(areaFilter(null))).toContain('""');
  });

  it('adds cluster counts only with a font the style has', () => {
    const ids = (font: string[] | null) =>
      browseLayers(null, font).map((l) => l.id);
    expect(ids(null)).not.toContain(CLUSTER_COUNT_LAYER);
    expect(ids(['Noto Sans Regular'])).toContain(CLUSTER_COUNT_LAYER);
  });
});

describe('styleLabelFont', () => {
  it('takes the first font a symbol layer uses', () => {
    expect(
      styleLabelFont([
        { type: 'fill' },
        { type: 'symbol', layout: { 'text-font': ['Roboto Regular'] } },
      ]),
    ).toEqual(['Roboto Regular']);
  });

  it('is null when only expressions are used', () => {
    expect(
      styleLabelFont([
        { type: 'symbol', layout: { 'text-font': ['get', 'font'] } },
      ]),
    ).toBeNull();
  });
});
