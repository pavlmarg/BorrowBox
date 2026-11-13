import type { ItemPricing, PriceUnit } from '../catalog/items';
import type { ProfilePhotoUrls } from '../identity/photos';

/**
 * Shapes shared by Bookings, the gateway and the PWA (ADR-0015). Plain types
 * only; validation classes live in the gateway and Bookings.
 *
 * Times are ISO-8601 UTC instants on whole hours; the PWA shows them in
 * Europe/Athens time. Periods are `[start, end)`.
 */

export const BOOKING_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'CONFIRMED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'PAID',
  'PICKED_UP',
  'RETURNED',
  'COMPLETED',
  'DISPUTED',
] as const;
/** The state machine is ARCHITECTURE.md §4 with ADR-0015's changes. */
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses that hold the item's period (the DB's no-double-booking rule). */
export const BOOKING_HOLDING_STATUSES = [
  'ACCEPTED',
  'CONFIRMED',
  'PAID',
  'PICKED_UP',
] as const satisfies readonly BookingStatus[];

/** Why a request was declined: by the lender, or it overlapped one they accepted. */
export const BOOKING_DECLINE_REASONS = ['LENDER', 'OVERLAP'] as const;
export type BookingDeclineReason = (typeof BOOKING_DECLINE_REASONS)[number];

/** Who or what cancelled a booking. */
export const BOOKING_CANCEL_REASONS = [
  'RENTER',
  'LENDER',
  'ITEM_DELETED',
  'ACCOUNT_DELETED',
] as const;
export type BookingCancelReason = (typeof BOOKING_CANCEL_REASONS)[number];

/**
 * A request nobody answered in time (`NO_ANSWER`) or whose start came first
 * (`STARTED`), or an accepted booking not paid by its pay-by time
 * (`PAYMENT_TIMEOUT`, ADR-0019).
 */
export const BOOKING_EXPIRE_REASONS = [
  'NO_ANSWER',
  'STARTED',
  'PAYMENT_TIMEOUT',
] as const;
export type BookingExpireReason = (typeof BOOKING_EXPIRE_REASONS)[number];

export type BookingCloseReason =
  BookingDeclineReason | BookingCancelReason | BookingExpireReason;

/** How many of each unit the rent pays for, e.g. 1 week + 2 days. */
export type PriceUnits = Record<PriceUnit, number>;

/** What a period costs (ADR-0015): the cheapest combination of offered units. */
export interface BookingPrice {
  rentCents: number;
  depositCents: number;
  /** The renter's service fee on top (ADR-0020); 0 when nothing is charged. */
  feeCents: number;
  /** What the renter pays: rent + deposit + fee. */
  totalCents: number;
  /** Taken from the lender's rent for the deposit's cost (ADR-0020). */
  lenderFeeCents: number;
  /** What the lender receives once the booking completes: rent − lender fee. */
  payoutCents: number;
  /**
   * The rate-card combination for the period. For a booking made from an
   * offer, it's what the rate card would have used; the rent is the offer's.
   */
  units: PriceUnits;
  /** Set when the price came from the lender's offer in chat (ADR-0018). */
  offerId: string | null;
}

export interface BookingParty {
  userId: string;
  /** Null once the account is deleted, or if Bookings hasn't heard the name yet. */
  displayName: string | null;
  /** Their public profile photo (ADR-0024), or null. */
  photo: ProfilePhotoUrls | null;
}

/** A booking as either of its two people sees it. */
export interface BookingView {
  id: string;
  /** The caller's side of it. */
  role: 'RENTER' | 'LENDER';
  itemId: string;
  /** The title when the booking was requested. */
  itemTitle: string;
  renter: BookingParty;
  lender: BookingParty;
  start: string;
  end: string;
  status: BookingStatus;
  price: BookingPrice;
  /** The item's rate card when the booking was requested. */
  pricing: ItemPricing;
  /** Why it was declined, cancelled or expired; otherwise null. */
  reason: BookingCloseReason | null;
  /** While `REQUESTED`: when it expires without an answer. */
  expiresAt: string | null;
  /** While `ACCEPTED`: when it expires unless paid (ADR-0019). */
  payBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingPeriod {
  start: string;
  end: string;
}
