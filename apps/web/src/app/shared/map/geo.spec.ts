import {
  circlePolygon,
  DEFAULT_CENTER,
  distanceM,
  pixelsAtZoom0,
  radiusCoveringView,
  zoomForRadius,
} from './geo';

describe('circlePolygon', () => {
  const ring = circlePolygon(DEFAULT_CENTER, 300, 32);

  it('is a closed ring', () => {
    expect(ring).toHaveLength(33);
    expect(ring[32]).toEqual(ring[0]);
  });

  it('puts every vertex at the radius', () => {
    for (const [lng, lat] of ring) {
      expect(distanceM(DEFAULT_CENTER, { lat, lng })).toBeCloseTo(300, 3);
    }
  });

  it('starts due north', () => {
    const [lng, lat] = ring[0];
    expect(lng).toBeCloseTo(DEFAULT_CENTER.lng, 9);
    expect(lat).toBeGreaterThan(DEFAULT_CENTER.lat);
  });
});

describe('pixelsAtZoom0', () => {
  it('matches the scale at zoom 12 in Athens (about 15 m per pixel)', () => {
    const at12 = pixelsAtZoom0(300, DEFAULT_CENTER.lat) * 2 ** 12;
    expect(at12).toBeGreaterThan(19);
    expect(at12).toBeLessThan(21);
  });
});

describe('distanceM', () => {
  it('measures Athens to Thessaloniki as about 300 km', () => {
    const km = distanceM(DEFAULT_CENTER, { lat: 40.6401, lng: 22.9444 }) / 1000;
    expect(km).toBeGreaterThan(295);
    expect(km).toBeLessThan(305);
  });
});

describe('zoomForRadius', () => {
  it('fits the circle into the map', () => {
    const zoom = zoomForRadius(5000, DEFAULT_CENTER.lat, 600);
    const diameterPx = 2 * pixelsAtZoom0(5000, DEFAULT_CENTER.lat) * 2 ** zoom;
    expect(diameterPx).toBeCloseTo(600 * 0.85, 6);
  });

  it('zooms out one step when the radius doubles', () => {
    const a = zoomForRadius(1000, DEFAULT_CENTER.lat, 500);
    const b = zoomForRadius(2000, DEFAULT_CENTER.lat, 500);
    expect(a - b).toBeCloseTo(1, 9);
  });

  it('stays within the map’s zoom range', () => {
    expect(zoomForRadius(1, DEFAULT_CENTER.lat, 2000)).toBe(18);
    expect(zoomForRadius(50_000_000, DEFAULT_CENTER.lat, 10)).toBe(0);
  });
});

describe('radiusCoveringView', () => {
  it('covers the whole visible map with the smallest allowed step', () => {
    // Zoom 13 in Athens: about 7.5 m per pixel (512 px tiles), so a
    // 1000×600 map's half diagonal is about 4.4 km: 5 km covers it.
    expect(radiusCoveringView(DEFAULT_CENTER.lat, 13, 1000, 600)).toBe(5);
  });

  it('takes a smaller step when zoomed in', () => {
    // Zoom 15: about 1.1 km, so 2 km.
    expect(radiusCoveringView(DEFAULT_CENTER.lat, 15, 1000, 600)).toBe(2);
  });

  it('stops at the largest step', () => {
    expect(radiusCoveringView(DEFAULT_CENTER.lat, 3, 1000, 600)).toBe(50);
  });
});
