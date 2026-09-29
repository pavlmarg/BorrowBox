const STORAGE_KEY = 'bb.returnUrl';
export const DEFAULT_AFTER_LOGIN = '/profile';

/**
 * Only same-app paths: must start with a single `/` (no `//host`, no
 * `/\host`, no scheme), so a crafted `?returnUrl=` can't redirect off-site.
 */
export function safeReturnUrl(url: string | null | undefined): string {
  if (!url || !url.startsWith('/') || url.startsWith('//')) {
    return DEFAULT_AFTER_LOGIN;
  }
  const hasControlChar = [...url].some((c) => c.charCodeAt(0) < 0x20);
  if (url.includes('\\') || hasControlChar) {
    return DEFAULT_AFTER_LOGIN;
  }
  return url.startsWith('/auth/') ? DEFAULT_AFTER_LOGIN : url;
}

/** Survives the full-page round-trip to Google. */
export function rememberReturnUrl(url: string | null | undefined): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, safeReturnUrl(url));
  } catch {
    // Storage unavailable (privacy mode): fall back to the default.
  }
}

export function takeReturnUrl(): string {
  try {
    const url = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    return safeReturnUrl(url);
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
}
