import type { DistanceBand } from '@borrowbox/contracts';

/**
 * Where the next page of a search starts: after the last item shown, by
 * distance to the public point and then id (D15). Opaque to clients.
 */
export interface SearchCursor {
  /** Metres from the searcher to the last item's public point. */
  distanceM: number;
  itemId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]{1,200}$/;

export function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(
    JSON.stringify({ d: cursor.distanceM, i: cursor.itemId }),
  ).toString('base64url');
}

/** Null for anything that isn't a cursor this service issued. */
export function decodeCursor(value: string): SearchCursor | null {
  if (!BASE64URL.test(value)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { d, i } = parsed as { d?: unknown; i?: unknown };
  if (typeof d !== 'number' || !Number.isFinite(d) || d < 0) return null;
  if (typeof i !== 'string' || !UUID.test(i)) return null;
  return { distanceM: d, itemId: i };
}

/** Distances are shown as bands, not numbers (ADR-0007). */
export function distanceBand(metres: number): DistanceBand {
  if (metres < 1_000) return 'UNDER_1_KM';
  if (metres < 2_000) return '1_2_KM';
  if (metres < 5_000) return '2_5_KM';
  if (metres < 10_000) return '5_10_KM';
  return 'OVER_10_KM';
}
