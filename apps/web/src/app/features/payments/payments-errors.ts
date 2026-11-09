import { HttpErrorResponse } from '@angular/common/http';
import type { ApiErrorResponse } from '../../api/models';
import { errorCode, errorKey } from '../../core/api-errors';

/**
 * Payments' own refusals, worded for the page they happen on. The shared
 * `errors.*` table doesn't know them yet (and maps an unknown 503 such as
 * `PROVIDER_UNAVAILABLE` to "something went wrong"), so each page names the
 * codes it explains under its own namespace and falls back to the shared
 * messages for everything else.
 */
export function apiCode(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const code = (error.error as Partial<ApiErrorResponse> | null)?.code;
  return typeof code === 'string' ? code : null;
}

/** `payouts.errors.EMAIL_NOT_VERIFIED`, or the shared `errors.*` key. */
export function featureErrorKey(
  error: unknown,
  namespace: string,
  codes: readonly string[],
): string {
  const code = apiCode(error);
  return code !== null && codes.includes(code)
    ? `${namespace}.errors.${code}`
    : errorKey(errorCode(error));
}
