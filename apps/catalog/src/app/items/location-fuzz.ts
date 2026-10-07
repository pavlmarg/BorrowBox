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

export interface PinContext {
  /**
   * The offset of the lender's nearest other item whose exact point is
   * within {@link NEW_PLACE_MIN_MOVE_M} of the new pin, if any.
   */
  sibling: LocationOffset | null;
  /** This item's stored offset, if it has a location. */
  current: LocationOffset | null;
  /** Distance from this item's old exact point, or null if there was none. */
  movedM: number | null;
}

/**
 * The offset for a pin being set or moved, in this order:
 * 1. the same place as another of the lender's items: share its offset
 *    (ADR-0011), so averaging their public points reveals nothing;
 * 2. this item moved less than {@link NEW_PLACE_MIN_MOVE_M}: keep its
 *    offset, so the public point moves exactly as far as the pin (ADR-0007);
 * 3. otherwise a new place: a fresh offset.
 */
export function offsetForPin(
  { sibling, current, movedM }: PinContext,
  random: () => number = secureRandomUnit,
): LocationOffset {
  if (sibling) return sibling;
  if (current && movedM !== null && movedM < NEW_PLACE_MIN_MOVE_M) {
    return current;
  }
  return drawOffset(random);
}
