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
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
  'NETWORK',
] as const;
export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

function isKnown(code: unknown): code is KnownErrorCode {
  return (KNOWN_ERROR_CODES as readonly unknown[]).includes(code);
}

/** The gateway's `{ code }` for an error, mapped to something we can show. */
export function errorCode(error: unknown): KnownErrorCode {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'NETWORK';
    const code = (error.error as Partial<ApiErrorResponse> | null)?.code;
    if (isKnown(code)) return code;
    return error.status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED';
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
