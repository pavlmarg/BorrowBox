import { HttpErrorResponse } from '@angular/common/http';
import type { ApiErrorResponse } from '../api/models';

/** Codes with a message in `errors.*` (both languages). */
export const KNOWN_ERROR_CODES = [
  'VALIDATION_FAILED',
  'MALFORMED_REQUEST',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'INVALID_REFRESH_TOKEN',
  'EMAIL_TAKEN',
  'REAUTHENTICATION_REQUIRED',
  'OAUTH_EXCHANGE_FAILED',
  'OAUTH_EMAIL_NOT_VERIFIED',
  'OAUTH_CANCELLED',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'PASSWORD_NOT_SET',
  'NOT_FOUND',
  'INVALID_STATE',
  'NOT_PUBLISHABLE',
  'ITEM_LIMIT_REACHED',
  'PHOTO_LIMIT_REACHED',
  'EMAIL_NOT_VERIFIED',
  'FORBIDDEN',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
  'NETWORK',
  /** Ours: a client error whose code has no message yet. */
  'UNKNOWN',
] as const;
export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

function isKnown(code: unknown): code is KnownErrorCode {
  return (KNOWN_ERROR_CODES as readonly unknown[]).includes(code);
}

/**
 * The gateway's error body. Calls without a response body (204/202) are made
 * with `responseType: 'text'`, so their error body arrives as unparsed JSON.
 */
export function apiErrorBody(
  error: HttpErrorResponse,
): Partial<ApiErrorResponse> | null {
  const body: unknown = error.error;
  if (typeof body === 'string') {
    try {
      const parsed: unknown = JSON.parse(body);
      return typeof parsed === 'object'
        ? (parsed as Partial<ApiErrorResponse>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof body === 'object'
    ? (body as Partial<ApiErrorResponse> | null)
    : null;
}

/** The gateway's `{ code }` for an error, mapped to something we can show. */
export function errorCode(error: unknown): KnownErrorCode {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'NETWORK';
    const code = apiErrorBody(error)?.code;
    if (isKnown(code)) return code;
    // Not "check the highlighted fields": nothing may be highlighted.
    return error.status >= 500 ? 'INTERNAL' : 'UNKNOWN';
  }
  return 'INTERNAL';
}

/** For codes arriving in a URL (e.g. `/auth/callback?error=`). */
export function knownCodeOr(
  code: string | null,
  fallback: KnownErrorCode,
): KnownErrorCode {
  return isKnown(code) ? code : fallback;
}

export function errorKey(code: KnownErrorCode): string {
  return `errors.${code}`;
}
