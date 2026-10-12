import type { GeoPoint } from '@borrowbox/contracts';
import { LOCATION_OFFSET_MAX_M } from '@borrowbox/contracts';
import type { FeatureCollection } from 'geojson';
import type { AddLayerObject } from 'maplibre-gl';
import { circlePolygon, pixelsAtZoom0 } from './geo';

/**
 * Sources and layers MapView adds on top of the base style. Pure data, so
 * they're testable without WebGL. Canvas layers can't read CSS variables;
 * the colours are the theme's sky tokens (styles.scss).
 */
type CirclePaint = NonNullable<
  Extract<AddLayerObject, { type: 'circle' }>['paint']
>;
/** A colour, or an expression choosing one per item. */
export type ColourValue = CirclePaint['circle-color'];

export const SKY_500 = '#4aa8f0';
export const SKY_700 = '#1f6fb2';

export const ITEMS_SOURCE = 'bb-items';
export const AREA_SOURCE = 'bb-area';
export const SEARCH_SOURCE = 'bb-search';

export const CLUSTERS_LAYER = 'bb-clusters';
export const CLUSTER_COUNT_LAYER = 'bb-cluster-count';
export const ITEM_AREAS_LAYER = 'bb-item-areas';

/** An item on the map, at its public (fuzzed) point. */
export interface MapPoint {
  id: string;
  location: GeoPoint;
}

/** Clusters dissolve into single items above this zoom. */
export const CLUSTER_MAX_ZOOM = 13;

/**
 * Each item as a point, carrying how big its circle is at zoom 0 so the
 * circle layer can draw it at its true size at any zoom (D6).
 */
export function itemsData(points: readonly MapPoint[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map(({ id, location }) => ({
      type: 'Feature',
      id,
      properties: {
        id,
        r0: pixelsAtZoom0(LOCATION_OFFSET_MAX_M, location.lat),
      },
      geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
    })),
  };
}

/** One circle polygon, e.g. an item's approximate area or the search radius. */
export function circleData(
  center: GeoPoint | null,
  radiusM: number,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: center
      ? [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [circlePolygon(center, radiusM)],
            },
          },
        ]
      : [],
  };
}

/**
 * Below this zoom an item's true circle would be a few pixels wide, so it
 * keeps that zoom's size instead: shown larger than the area, never as a dot.
 */
const TRUE_SIZE_FROM_ZOOM = 11;
const MAX_ZOOM = 22;

/**
 * Bubbles with counts when zoomed out; circles of the offset radius at the
 * public points when zoomed in. Never a pin (ADR-0007). `labelFont` is a
 * font the base style has glyphs for; without one, bubbles show no count.
 */
export function browseLayers(
  selectedId: string | null,
  labelFont: string[] | null,
): AddLayerObject[] {
  const layers: AddLayerObject[] = [
    {
      id: CLUSTERS_LAYER,
      type: 'circle',
      source: ITEMS_SOURCE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': SKY_500,
        'circle-opacity': 0.85,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26],
      },
    },
    {
      id: ITEM_AREAS_LAYER,
      type: 'circle',
      source: ITEMS_SOURCE,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': itemColour(selectedId),
        'circle-opacity': 0.28,
        'circle-stroke-color': itemColour(selectedId),
        'circle-stroke-width': 2,
        'circle-pitch-alignment': 'map',
        'circle-radius': [
          'interpolate',
          ['exponential', 2],
          ['zoom'],
          TRUE_SIZE_FROM_ZOOM,
          ['*', ['get', 'r0'], 2 ** TRUE_SIZE_FROM_ZOOM],
          MAX_ZOOM,
          ['*', ['get', 'r0'], 2 ** MAX_ZOOM],
        ],
      },
    },
  ];
  if (labelFont) {
    layers.push({
      id: CLUSTER_COUNT_LAYER,
      type: 'symbol',
      source: ITEMS_SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': labelFont,
        'text-size': 13,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#ffffff' },
    });
  }
  return layers;
}

/** An item circle's radius in pixels at `zoom`, as the layer above draws it. */
export function itemRadiusPx(r0: number, zoom: number): number {
  return r0 * 2 ** Math.min(Math.max(zoom, TRUE_SIZE_FROM_ZOOM), MAX_ZOOM);
}

/** The selected item stands out in the darker blue. */
export function itemColour(selectedId: string | null): ColourValue {
  return selectedId === null
    ? SKY_500
    : ['case', ['==', ['get', 'id'], selectedId], SKY_700, SKY_500];
}

/** A filled circle: an item's approximate area. */
export function areaLayers(): AddLayerObject[] {
  return [
    {
      id: 'bb-area-fill',
      type: 'fill',
      source: AREA_SOURCE,
      paint: { 'fill-color': SKY_500, 'fill-opacity': 0.22 },
    },
    {
      id: 'bb-area-line',
      type: 'line',
      source: AREA_SOURCE,
      paint: { 'line-color': SKY_700, 'line-width': 2 },
    },
  ];
}

/** A dashed outline: the search radius. */
export function searchLayers(): AddLayerObject[] {
  return [
    {
      id: 'bb-search-line',
      type: 'line',
      source: SEARCH_SOURCE,
      paint: {
        'line-color': SKY_700,
        'line-width': 1.5,
        'line-dasharray': [3, 2],
      },
    },
  ];
}

// Expressions start with an operator, font stacks with a font name.
const EXPRESSION_OPERATORS = new Set([
  'get',
  'case',
  'match',
  'step',
  'coalesce',
  'interpolate',
  'literal',
]);

/** A font the base style already uses for labels, so its glyphs exist. */
export function styleLabelFont(
  layers: ReadonlyArray<{ type: string; layout?: Record<string, unknown> }>,
): string[] | null {
  for (const layer of layers) {
    const font = layer.layout?.['text-font'];
    if (
      layer.type === 'symbol' &&
      Array.isArray(font) &&
      font.length > 0 &&
      font.every((f) => typeof f === 'string') &&
      !EXPRESSION_OPERATORS.has(font[0])
    ) {
      return font as string[];
    }
  }
  return null;
}
