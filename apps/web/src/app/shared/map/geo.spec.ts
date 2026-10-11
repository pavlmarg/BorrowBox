import { circlePolygon, DEFAULT_CENTER, distanceM, pixelsAtZoom0 } from './geo';

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
