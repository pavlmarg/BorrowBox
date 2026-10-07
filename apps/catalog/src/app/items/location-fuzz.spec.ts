import {
  drawOffset,
  NEW_PLACE_MIN_MOVE_M,
  OFFSET_MAX_M,
  OFFSET_MIN_M,
  offsetForPin,
  secureRandomUnit,
} from './location-fuzz';

describe('location fuzzing', () => {
  describe('secureRandomUnit', () => {
    it('stays in [0, 1) and spreads evenly', () => {
      const samples = Array.from({ length: 20_000 }, secureRandomUnit);
      expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...samples)).toBeLessThan(1);
      // Each tenth of the range gets ~2,000 samples; 1,700–2,300 is > 7 σ.
      const buckets = new Array(10).fill(0);
      for (const s of samples) buckets[Math.floor(s * 10)]++;
      for (const count of buckets) {
        expect(count).toBeGreaterThan(1_700);
        expect(count).toBeLessThan(2_300);
      }
    });
  });

  describe('drawOffset', () => {
    it('maps the ends of the random range to the ends of the offset range', () => {
      expect(drawOffset(() => 0)).toEqual({
        distanceM: OFFSET_MIN_M,
        bearingDeg: 0,
      });
      const top = drawOffset(() => 1 - 2 ** -48);
      expect(top.distanceM).toBeLessThan(OFFSET_MAX_M);
      expect(top.distanceM).toBeCloseTo(OFFSET_MAX_M, 6);
      expect(top.bearingDeg).toBeLessThan(360);
    });

    it('always lands within 150-300 m and 0-360°', () => {
      for (let i = 0; i < 10_000; i++) {
        const { distanceM, bearingDeg } = drawOffset();
        expect(distanceM).toBeGreaterThanOrEqual(OFFSET_MIN_M);
        expect(distanceM).toBeLessThan(OFFSET_MAX_M);
        expect(bearingDeg).toBeGreaterThanOrEqual(0);
        expect(bearingDeg).toBeLessThan(360);
      }
    });

    it('draws distance and direction independently', () => {
      const values = [0.25, 0.75];
      const offset = drawOffset(() => values.shift() as number);
      expect(offset).toEqual({ distanceM: 187.5, bearingDeg: 270 });
    });
  });

  describe('offsetForPin', () => {
    const stored = { distanceM: 210, bearingDeg: 33 };
    const fresh = () => 0.5;

    it('draws an offset for a first pin', () => {
      expect(offsetForPin(null, null, fresh)).toEqual({
        distanceM: 225,
        bearingDeg: 180,
      });
    });

    it('keeps the stored offset for a move under 300 m, including none', () => {
      expect(offsetForPin(stored, 0, fresh)).toBe(stored);
      expect(offsetForPin(stored, NEW_PLACE_MIN_MOVE_M - 0.001, fresh)).toBe(
        stored,
      );
    });

    it('draws a new offset for a move of 300 m or more', () => {
      expect(offsetForPin(stored, NEW_PLACE_MIN_MOVE_M, fresh)).toEqual({
        distanceM: 225,
        bearingDeg: 180,
      });
      expect(offsetForPin(stored, 5_000, fresh)).not.toBe(stored);
    });
  });
});
