import { HttpErrorResponse } from '@angular/common/http';
import type { ApiErrorResponse } from '../../api/models';
import { errorCode } from '../../core/api-errors';

/**
 * Codes chat and offers explain in their own words (`chat.errors.*`): the
 * shared `errors.*` don't have them, or say something about items instead.
 */
const CHAT_CODES = [
  'NOT_FOUND',
  'CONVERSATION_CLOSED',
  'OFFER_UNAVAILABLE',
  'PRICE_ABOVE_LIST',
  'PAYOUTS_NOT_SET_UP',
  'OWN_ITEM',
  'ITEM_UNAVAILABLE',
  'SLOT_TAKEN',
  'INVALID_PERIOD',
  'RATE_LIMITED',
] as const;

export interface ChatError {
  /** The gateway's code, for decisions (e.g. a link to Settings). */
  code: string;
  /** What to show. */
  key: string;
}

/** An error from a chat or offer call, with the message to show. */
export function chatError(error: unknown): ChatError {
  const raw =
    error instanceof HttpErrorResponse
      ? (error.error as Partial<ApiErrorResponse> | null)?.code
      : undefined;
  if ((CHAT_CODES as readonly unknown[]).includes(raw)) {
    return { code: raw as string, key: `chat.errors.${raw as string}` };
  }
  const known = errorCode(error);
  return { code: known, key: `errors.${known}` };
}
