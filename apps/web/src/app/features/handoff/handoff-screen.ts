import { HANDOFF_CODE_LENGTH } from '@borrowbox/contracts';
import type {
  BookingStatus,
  BookingViewResponse,
  HandoffPhase,
  HandoffTokenResponse,
} from '../../api/models';
import {
  bookingErrorKey,
  type AnyBookingError,
} from '../bookings/booking-text';

/** Fetch the next code at least this long before the shown one expires. */
const EXPIRY_MARGIN_MS = 10_000;
const MIN_DELAY_MS = 1_000;

/**
 * When the showing screen fetches its next code: when the server says, but
 * never so late that a scan of the shown code could arrive after it expired.
 */
export function nextTokenDelayMs(
  token: HandoffTokenResponse,
  now: number,
): number {
  const suggested = token.refreshAfterSeconds * 1000;
  const beforeExpiry = Date.parse(token.expiresAt) - now - EXPIRY_MARGIN_MS;
  return Math.max(MIN_DELAY_MS, Math.min(suggested, beforeExpiry));
}

const AFTER_PICKUP: readonly BookingStatus[] = [
  'PICKED_UP',
  'RETURNED',
  'COMPLETED',
  'DISPUTED',
];
const AFTER_RETURN: readonly BookingStatus[] = [
  'RETURNED',
  'COMPLETED',
  'DISPUTED',
];

/** Whether this handoff already happened (by a scan, or the answers). */
export function handoffDone(
  booking: BookingViewResponse,
  phase: HandoffPhase,
): boolean {
  return (phase === 'PICKUP' ? AFTER_PICKUP : AFTER_RETURN).includes(
    booking.status,
  );
}

/** Refusals with handoff words; others use the bookings messages. */
const SCAN_ERRORS = [
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'RATE_LIMITED',
  'NOT_COUNTERPARTY',
  'HANDOFF_UNAVAILABLE',
  'INVALID_STATE',
] as const;

/**
 * The message for a refused scan. A wrong typed code reads differently from
 * a QR that isn't this booking's.
 */
export function scanErrorKey(
  code: AnyBookingError,
  method: 'QR' | 'CODE',
): string {
  if (code === 'TOKEN_INVALID') return `handoff.errors.TOKEN_INVALID_${method}`;
  return (SCAN_ERRORS as readonly string[]).includes(code)
    ? `handoff.errors.${code}`
    : bookingErrorKey(code);
}

/** After these, scanning again right away can't help. */
export function scanErrorIsFinal(code: AnyBookingError): boolean {
  return (
    code === 'NOT_COUNTERPARTY' ||
    code === 'INVALID_STATE' ||
    code === 'NOT_FOUND'
  );
}

/** Digits only (spaces and dashes typed along are dropped), at most 6. */
export function cleanCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, HANDOFF_CODE_LENGTH);
}

export function isFullCode(code: string): boolean {
  return code.length === HANDOFF_CODE_LENGTH;
}

/** "482913" → "482 913", easier to read aloud. */
export function groupCode(code: string): string {
  return code.replace(/^(\d{3})(\d{3})$/, '$1 $2');
}
