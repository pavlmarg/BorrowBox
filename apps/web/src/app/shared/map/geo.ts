import {
  SEARCH_RADIUS_KM,
  type GeoPoint,
  type SearchRadiusKm,
} from '@borrowbox/contracts';

/** Where maps start when nothing else is known (ADR-0008): central Athens. */
export const DEFAULT_CENTER: GeoPoint = { lat: 37.9838, lng: 23.7275 };

const EARTH_RADIUS_M = 6_371_008.8;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/** MapLibre's world is 512 px wide at zoom 0. */
const TILE_SIZE_PX = 512;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * A closed ring of `[lng, lat]` positions approximating a circle on the
 * Earth's surface (GeoJSON polygon order), e.g. an item's approximate area.
 */
export function circlePolygon(
  center: GeoPoint,
  radiusM: number,
  steps = 64,
): Array<[number, number]> {
  const lat1 = toRad(center.lat);
  const lng1 = toRad(center.lng);
  const angular = radiusM / EARTH_RADIUS_M;
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) +
        Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
      );
    ring.push([toDeg(lng2), toDeg(lat2)]);
  }
  ring.push(ring[0]);
  return ring;
}

/**
 * How many pixels `radiusM` spans at zoom 0 at this latitude. Doubling it
 * per zoom level gives the on-screen radius at any zoom.
 */
export function pixelsAtZoom0(radiusM: number, lat: number): number {
  const metresPerPixel =
    (EARTH_CIRCUMFERENCE_M * Math.cos(toRad(lat))) / TILE_SIZE_PX;
  return radiusM / metresPerPixel;
}

/** Great-circle distance in metres. */
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * The zoom at which a circle of `radiusM` fills about `fill` of a map whose
 * shorter side is `sizePx` (e.g. to fit the search radius).
 */
export function zoomForRadius(
  radiusM: number,
  lat: number,
  sizePx: number,
  fill = 0.85,
): number {
  const diameterAtZoom0 = 2 * pixelsAtZoom0(radiusM, lat);
  const zoom = Math.log2((sizePx * fill) / diameterAtZoom0);
  return Math.min(18, Math.max(0, zoom));
}

/**
 * The smallest allowed search radius (ADR-0007's fixed steps) whose circle
 * around the map's centre contains the whole visible map: half its
 * diagonal, in metres at this zoom. Capped at the largest step.
 */
export function radiusCoveringView(
  lat: number,
  zoom: number,
  widthPx: number,
  heightPx: number,
): SearchRadiusKm {
  const metresPerPixel =
    (EARTH_CIRCUMFERENCE_M * Math.cos(toRad(lat))) / (TILE_SIZE_PX * 2 ** zoom);
  const halfDiagonalKm =
    ((Math.hypot(widthPx, heightPx) / 2) * metresPerPixel) / 1000;
  return (
    SEARCH_RADIUS_KM.find((km) => km >= halfDiagonalKm) ??
    SEARCH_RADIUS_KM[SEARCH_RADIUS_KM.length - 1]
  );
}
