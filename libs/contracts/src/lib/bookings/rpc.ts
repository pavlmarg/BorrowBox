/**
 * Gateway → Bookings request/response contracts (NestJS TCP, ADR-0005).
 *
 * Plain types only: requests are validated with class-validator in the
 * gateway (HTTP) and again in Bookings (RPC). The caller is identified from
 * `RpcRequest.accessToken`, never from ids in `data`; who may act on a
 * booking is checked inside Bookings.
 */
import type {
  BookingPeriod,
  BookingPrice,
  BookingStatus,
  BookingView,
} from './bookings';

/** Carried in `RpcErrorBody.code` (see `../rpc/rpc.ts`). */
export type BookingsErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  /**
   * Unknown booking, or one the caller isn't part of; unknown or
   * unbookable item for public queries. Existence is never confirmed.
   */
  | 'NOT_FOUND'
  /** The action doesn't fit the booking's status or role, e.g. accepting a cancelled one. */
  | 'INVALID_STATE'
  /**
   * The period breaks a rule: whole hours, 1 hour to 90 days, starting 1 hour
   * to 180 days ahead, within the item's own shortest and longest booking.
   */
  | 'INVALID_PERIOD'
  /** The item isn't open for requests (paused, draft or deleted). */
  | 'ITEM_UNAVAILABLE'
  /** Lenders can't book their own items. */
  | 'OWN_ITEM'
  /** Requesting needs a verified email. */
  | 'EMAIL_NOT_VERIFIED'
  /** The period overlaps a booking that already holds the item. */
  | 'SLOT_TAKEN'
  /** The renter already has an open request or booking for this item that overlaps. */
  | 'DUPLICATE_REQUEST'
  /** The renter already has `BOOKING_OPEN_REQUESTS_MAX` open requests. */
  | 'REQUEST_LIMIT_REACHED'
  /** Unexpected failure; details are only in Bookings' logs. */
  | 'INTERNAL';

// --- Requests ---------------------------------------------------------------

export interface BookingRef {
  bookingId: string;
}

/** A period of an item: for a quote, or with a booking id for a request. */
export interface ItemPeriodRequest {
  itemId: string;
  /** ISO-8601 instants on whole hours. */
  start: string;
  end: string;
}

export interface RequestBookingRequest extends ItemPeriodRequest {
  /**
   * A new random UUID chosen by the client, once per request. Sending the
   * same request again returns the existing booking, so retries are safe.
   */
  bookingId: string;
}

export interface QuoteResponse extends BookingPrice {
  itemId: string;
  start: string;
  end: string;
}

export interface BusyPeriodsRequest {
  itemId: string;
}

/**
 * When the item is taken, from now on, earliest first. Only the periods:
 * never who booked them or in which state.
 */
export interface BusyPeriodsResponse {
  periods: BookingPeriod[];
}

export const BOOKING_LIST_LIMIT_DEFAULT = 20;
export const BOOKING_LIST_LIMIT_MAX = 50;

export interface ListBookingsRequest {
  /** The caller's bookings as renter or as lender. */
  role: 'RENTER' | 'LENDER';
  /** Only these statuses; all if omitted. */
  statuses?: BookingStatus[];
  /** From the previous page's `nextCursor`. */
  cursor?: string;
  limit?: number;
}

/** Newest request first. */
export interface ListBookingsResponse {
  bookings: BookingView[];
  nextCursor: string | null;
}

/** Bookings' part of `GET /me/export`. */
export interface BookingsDataExport {
  exportedAt: string;
  /** Bookings' copy of the caller's name (from Identity's events), or null. */
  profile: { displayName: string; updatedAt: string } | null;
  /** When Bookings learned the email was verified (requesting needs it), or null. */
  emailVerifiedAt: string | null;
  asRenter: BookingView[];
  asLender: BookingView[];
}

// --- Patterns ---------------------------------------------------------------

export const BookingsRpc = {
  // Public (no token needed).
  quote: 'bookings.quote',
  busyPeriods: 'bookings.items.busy',
  // The caller's bookings.
  request: 'bookings.request',
  accept: 'bookings.accept',
  decline: 'bookings.decline',
  cancel: 'bookings.cancel',
  get: 'bookings.get',
  listMine: 'bookings.list',
  // GDPR.
  exportMe: 'bookings.me.export',
} as const;

/** Pattern → request/response types, for typed clients and handlers. */
export interface BookingsRpcContract {
  [BookingsRpc.quote]: { request: ItemPeriodRequest; response: QuoteResponse };
  [BookingsRpc.busyPeriods]: {
    request: BusyPeriodsRequest;
    response: BusyPeriodsResponse;
  };
  [BookingsRpc.request]: {
    request: RequestBookingRequest;
    response: BookingView;
  };
  [BookingsRpc.accept]: { request: BookingRef; response: BookingView };
  [BookingsRpc.decline]: { request: BookingRef; response: BookingView };
  [BookingsRpc.cancel]: { request: BookingRef; response: BookingView };
  [BookingsRpc.get]: { request: BookingRef; response: BookingView };
  [BookingsRpc.listMine]: {
    request: ListBookingsRequest;
    response: ListBookingsResponse;
  };
  [BookingsRpc.exportMe]: {
    request: Record<string, never>;
    response: BookingsDataExport;
  };
}

export type BookingsRpcPattern = keyof BookingsRpcContract;
