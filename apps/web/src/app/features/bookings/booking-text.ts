import { HttpErrorResponse } from '@angular/common/http';
import type {
  ApiErrorResponse,
  BookingStatus,
  BookingViewResponse,
  PriceUnit,
  PriceUnitsResponse,
} from '../../api/models';
import {
  errorCode,
  errorKey,
  type KnownErrorCode,
} from '../../core/api-errors';

/** Bookings' own refusals, with messages under `bookings.errors`. */
export const BOOKING_ERROR_CODES = [
  'SLOT_TAKEN',
  'DUPLICATE_REQUEST',
  'REQUEST_LIMIT_REACHED',
  'OWN_ITEM',
  'ITEM_UNAVAILABLE',
  'INVALID_PERIOD',
  'PAYOUTS_NOT_SET_UP',
  // Generic codes that need booking words here.
  'NOT_FOUND',
  'INVALID_STATE',
  'EMAIL_NOT_VERIFIED',
] as const;
export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];

export type AnyBookingError = BookingErrorCode | KnownErrorCode;

function isBookingCode(code: unknown): code is BookingErrorCode {
  return (BOOKING_ERROR_CODES as readonly unknown[]).includes(code);
}

/** The gateway's code for a failed booking call. */
export function bookingErrorCode(error: unknown): AnyBookingError {
  if (error instanceof HttpErrorResponse) {
    const code = (error.error as Partial<ApiErrorResponse> | null)?.code;
    if (isBookingCode(code)) return code;
  }
  return errorCode(error);
}

export function bookingErrorKey(code: AnyBookingError): string {
  return isBookingCode(code)
    ? `bookings.errors.${code}`
    : errorKey(code as KnownErrorCode);
}

/** Still going on (or about to). */
export const CURRENT_STATUSES: readonly BookingStatus[] = [
  'REQUESTED',
  'ACCEPTED',
  'CONFIRMED',
  'PAID',
  'PICKED_UP',
  'RETURNED',
  'DISPUTED',
];
/** Over, one way or another. */
export const PAST_STATUSES: readonly BookingStatus[] = [
  'COMPLETED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
];

export type StatusTone = 'waiting' | 'good' | 'closed' | 'alert';

/** The status chip's colour family. */
export function statusTone(status: BookingStatus): StatusTone {
  switch (status) {
    case 'REQUESTED':
    case 'ACCEPTED':
      return 'waiting';
    case 'CONFIRMED':
    case 'PAID':
    case 'PICKED_UP':
    case 'RETURNED':
    case 'COMPLETED':
      return 'good';
    case 'DISPUTED':
      return 'alert';
    default:
      return 'closed';
  }
}

/** The other person of a booking, from the caller's side. */
export function otherParty(booking: BookingViewResponse) {
  return booking.role === 'RENTER' ? booking.lender : booking.renter;
}

const UNIT_ORDER: readonly PriceUnit[] = ['MONTH', 'WEEK', 'DAY', 'HOUR'];

/**
 * What the rent pays for, as translation keys with counts, largest unit
 * first: `{ key: 'bookings.units.WEEK.one', n: 1 }`, …
 */
export function unitParts(
  units: PriceUnitsResponse,
): Array<{ key: string; n: number }> {
  return UNIT_ORDER.filter((u) => units[u] > 0).map((u) => ({
    key: `bookings.units.${u}.${units[u] === 1 ? 'one' : 'other'}`,
    n: units[u],
  }));
}

/**
 * A length in hours as translation keys: "2 days 5 hours". Days are
 * 24 hours, as in pricing (ADR-0015).
 */
export function durationParts(
  hours: number,
): Array<{ key: string; n: number }> {
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const parts: Array<{ key: string; n: number }> = [];
  if (days > 0) {
    parts.push({
      key: `bookings.units.DAY.${days === 1 ? 'one' : 'other'}`,
      n: days,
    });
  }
  if (rest > 0 || days === 0) {
    parts.push({
      key: `bookings.units.HOUR.${rest === 1 ? 'one' : 'other'}`,
      n: rest,
    });
  }
  return parts;
}

/** Ms left until `iso`, never below 0, as hours / minutes / seconds. */
export function timeLeft(
  iso: string,
  now: number,
): { ms: number; hours: number; minutes: number; seconds: number } {
  const ms = Math.max(0, Date.parse(iso) - now);
  const total = Math.floor(ms / 1000);
  return {
    ms,
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** Either side may cancel these before the start (ADR-0015, ADR-0021). */
export function canCancel(booking: BookingViewResponse, now: number): boolean {
  return (
    (booking.status === 'ACCEPTED' ||
      booking.status === 'CONFIRMED' ||
      booking.status === 'PAID') &&
    now < Date.parse(booking.start)
  );
}
