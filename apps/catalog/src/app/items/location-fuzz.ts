import { randomBytes } from 'node:crypto';

/**
 * Location privacy (ADR-0007). The public point is the exact pin moved by a
 * random offset drawn once per place: a distance uniform in [150, 300) m and
 * a direction uniform in [0, 360)°. PostGIS applies it (`ST_Project`); this
 * module only decides which offset to use.
 */
export const OFFSET_MIN_M = 150;
export const OFFSET_MAX_M = 300;
/** A pin moved less than this keeps its offset; further away is a new place. */
export const NEW_PLACE_MIN_MOVE_M = 300;

export interface LocationOffset {
  distanceM: number;
  /** Degrees clockwise from north. */
  bearingDeg: number;
}

/**
 * A uniform number in [0, 1) from the OS's cryptographic generator, so
 * offsets can't be predicted from ones seen before (unlike Math.random).
 */
export function secureRandomUnit(): number {
  return randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

export function drawOffset(
  random: () => number = secureRandomUnit,
): LocationOffset {
  return {
    distanceM: OFFSET_MIN_M + random() * (OFFSET_MAX_M - OFFSET_MIN_M),
    bearingDeg: random() * 360,
  };
}

/**
 * The offset for a pin being set or moved: the stored one if the pin moved
 * less than {@link NEW_PLACE_MIN_MOVE_M} (so the public point moves exactly
 * as far as the pin did), otherwise a fresh one.
 *
 * @param movedM distance from the old exact point, or null if there was none
 */
export function offsetForPin(
  current: LocationOffset | null,
  movedM: number | null,
  random: () => number = secureRandomUnit,
): LocationOffset {
  if (current && movedM !== null && movedM < NEW_PLACE_MIN_MOVE_M) {
    return current;
  }
  return drawOffset(random);
}
