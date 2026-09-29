import type { CookieOptions, Response } from 'express';

/**
 * Refresh token: httpOnly (no JS access), Secure, SameSite=Strict (never sent
 * on cross-site requests, which also covers CSRF on /auth/refresh and
 * /auth/logout), and scoped to the auth endpoints only.
 * Browsers accept Secure cookies on http://localhost, so dev works too.
 */
export const REFRESH_COOKIE = 'bb_refresh';
const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/auth',
};

/**
 * Google sign-in state (state, nonce, PKCE verifier). Signed, 10 minutes, and
 * SameSite=Lax because Google's redirect back is a cross-site navigation that
 * would not carry a Strict cookie.
 */
export const OAUTH_COOKIE = 'bb_oauth';
export const OAUTH_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;
const OAUTH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  signed: true,
  path: '/api/auth/google',
};

export function setRefreshCookie(
  res: Response,
  refreshToken: string,
  expiresAt: string,
): void {
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...REFRESH_COOKIE_OPTIONS,
    expires: new Date(expiresAt),
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_OPTIONS);
}

export interface OAuthState {
  /** state */
  s: string;
  /** nonce */
  n: string;
  /** PKCE code verifier */
  v: string;
}

export function setOAuthCookie(res: Response, state: OAuthState): void {
  res.cookie(OAUTH_COOKIE, JSON.stringify(state), {
    ...OAUTH_COOKIE_OPTIONS,
    maxAge: OAUTH_COOKIE_MAX_AGE_MS,
  });
}

export function clearOAuthCookie(res: Response): void {
  res.clearCookie(OAUTH_COOKIE, OAUTH_COOKIE_OPTIONS);
}

/** The verified (signed) OAuth cookie, or null if missing, tampered or malformed. */
export function readOAuthCookie(
  signedCookies: Record<string, unknown> | undefined,
): OAuthState | null {
  const raw = signedCookies?.[OAUTH_COOKIE];
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OAuthState>;
    return typeof parsed.s === 'string' &&
      typeof parsed.n === 'string' &&
      typeof parsed.v === 'string'
      ? { s: parsed.s, n: parsed.n, v: parsed.v }
      : null;
  } catch {
    return null;
  }
}
