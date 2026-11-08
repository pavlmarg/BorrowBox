import type { BookingParty } from '../bookings/bookings';

/**
 * In-app chat (ADR-0017) and price offers (ADR-0018): shapes shared by
 * Bookings (which hosts Messaging for now), the gateway and the PWA.
 */

/** A message's text, in characters. */
export const MESSAGE_TEXT_MAX_LENGTH = 2000;
export const MESSAGES_PAGE_DEFAULT = 50;
export const MESSAGES_PAGE_MAX = 100;
export const CONVERSATIONS_PAGE_DEFAULT = 20;
export const CONVERSATIONS_PAGE_MAX = 50;

/** An offer is valid this long, or until `BOOKING_MIN_LEAD_HOURS` before its start if sooner. */
export const OFFER_VALID_HOURS = 48;

/** Per-user limits, counted in the gateway. */
export const MESSAGES_PER_MINUTE = 30;
export const NEW_CONVERSATIONS_PER_DAY = 20;

export const MESSAGE_KINDS = ['TEXT', 'SYSTEM', 'OFFER'] as const;
/** `TEXT` from a person, `SYSTEM` a booking moment, `OFFER` a price offer card. */
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** System lines carry a code; the PWA shows the text in the reader's language. */
export const SYSTEM_MESSAGE_CODES = [
  'BOOKING_REQUESTED',
  'BOOKING_ACCEPTED',
  /** Also asks both to arrange where and when to meet (ADR-0015). */
  'BOOKING_CONFIRMED',
  /** The renter paid; also asks both to arrange where and when to meet. */
  'BOOKING_PAID',
  'BOOKING_DECLINED',
  'BOOKING_CANCELLED',
  'BOOKING_EXPIRED',
  'OFFER_WITHDRAWN',
] as const;
export type SystemMessageCode = (typeof SYSTEM_MESSAGE_CODES)[number];

export const OFFER_STATUSES = [
  'OPEN',
  'USED',
  'WITHDRAWN',
  'REPLACED',
  'EXPIRED',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const REPORT_REASONS = ['SPAM', 'SCAM', 'ABUSE', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** A price offer from the lender (ADR-0018). */
export interface OfferView {
  id: string;
  conversationId: string;
  itemId: string;
  start: string;
  end: string;
  rentCents: number;
  /** The item's deposit; not negotiable. */
  depositCents: number;
  /** The renter's service fee for this offer (ADR-0020). */
  feeCents: number;
  /** What the renter would pay: rent + deposit + fee. */
  totalCents: number;
  /** What the rate card would charge for the period, for comparison. */
  listRentCents: number;
  status: OfferStatus;
  expiresAt: string;
  /** Set once the renter booked it. */
  bookingId: string | null;
  createdAt: string;
}

export interface MessageView {
  id: string;
  conversationId: string;
  kind: MessageKind;
  /** Null for system lines. */
  senderId: string | null;
  /** True if the reader sent it. */
  mine: boolean;
  /**
   * `TEXT` only. Contact details are masked unless the two have a booking
   * that went ahead (ADR-0017). Null once the sender's account is erased.
   */
  text: string | null;
  deleted: boolean;
  systemCode: SystemMessageCode | null;
  bookingId: string | null;
  /** `OFFER` only: the offer as it is now. */
  offer: OfferView | null;
  sentAt: string;
}

export interface ConversationView {
  id: string;
  itemId: string;
  /** The title when the conversation started. */
  itemTitle: string;
  /** The reader's side: `RENTER` asked, `LENDER` owns the item. */
  role: 'RENTER' | 'LENDER';
  other: BookingParty;
  lastMessage: MessageView | null;
  lastMessageAt: string;
  unreadCount: number;
  /** Up to when the other person has read, for "seen". */
  otherReadAt: string | null;
  /** True when the item is deleted or an account erased: nobody can write. */
  closed: boolean;
  openOffer: OfferView | null;
  createdAt: string;
}

// --- Live push (Redis pub/sub → gateway → Socket.IO) -------------------------

/** Redis channel per recipient: `chat:<userId>`. */
export const CHAT_CHANNEL_PREFIX = 'chat:';
/** Socket.IO namespace and the event the gateway emits. */
export const CHAT_NAMESPACE = '/chat';
export const CHAT_SOCKET_EVENT = 'chat';

/** What a recipient's socket receives; each is already shaped for that reader. */
export type ChatPush =
  | { type: 'message'; conversationId: string; message: MessageView }
  | { type: 'read'; conversationId: string; readerId: string; readAt: string }
  | { type: 'offer'; conversationId: string; offer: OfferView };
