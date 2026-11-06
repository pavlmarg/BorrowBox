/**
 * Where the next page of "my bookings" starts: after the last booking
 * shown, by creation time and then id. Opaque to clients.
 */
export interface ListCursor {
  createdAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]{1,200}$/;

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.createdAt.getTime(), i: cursor.id }),
  ).toString('base64url');
}

/** Null for anything that isn't a cursor this service issued. */
export function decodeListCursor(value: string): ListCursor | null {
  if (!BASE64URL.test(value)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { t, i } = parsed as { t?: unknown; i?: unknown };
  if (typeof t !== 'number' || !Number.isSafeInteger(t) || t < 0) return null;
  if (typeof i !== 'string' || !UUID.test(i)) return null;
  return { createdAt: new Date(t), id: i };
}
