import { createHash, randomBytes } from 'node:crypto';

/** A session lasts at most this long from sign-in; rotation never extends it. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Opaque 256-bit token for the client (via the gateway's cookie). Never stored. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What is stored and looked up: SHA-256 of the token. */
export function hashRefreshToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Tokens are exactly 32 random bytes in base64url; anything else is rejected before a DB lookup. */
export function isWellFormedRefreshToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export interface StoredRefreshToken {
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
  user_deleted_at: Date | null;
}

/**
 * A token rotated this recently may be presented again without counting as
 * reuse: the answer to the first refresh can be lost on the way (a dropped
 * mobile connection), and the client then retries with the token it still
 * has. Within this window a thief replaying a copy isn't caught either.
 */
export const REFRESH_REUSE_LEEWAY_MS = 30_000;

export type RefreshDecision =
  /** Valid: mark it rotated and issue the next token in the same family. */
  | 'rotate'
  /** Rotated within the leeway: issue another token in the same family. */
  | 'reissue'
  /** Revoked, or rotated earlier: a copy is in someone else's hands. Revoke the family. */
  | 'reuse'
  /** Past the session lifetime, or the account is gone. */
  | 'expired';

export function decideRefresh(
  token: StoredRefreshToken,
  now: Date,
): RefreshDecision {
  if (token.revoked_at !== null) return 'reuse';
  if (
    token.rotated_at !== null &&
    now.getTime() - token.rotated_at.getTime() >= REFRESH_REUSE_LEEWAY_MS
  ) {
    return 'reuse';
  }
  if (token.user_deleted_at !== null) return 'expired';
  if (token.expires_at.getTime() <= now.getTime()) return 'expired';
  return token.rotated_at === null ? 'rotate' : 'reissue';
}
