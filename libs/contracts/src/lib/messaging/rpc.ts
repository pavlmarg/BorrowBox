/**
 * Gateway → Messaging request/response contracts (NestJS TCP, ADR-0005).
 * Messaging is a module of the Bookings service for now (ADR-0017), so these
 * patterns are served on Bookings' TCP endpoint.
 */
import type { BookingView } from '../bookings/bookings';
import type { ItemPeriodRequest } from '../bookings/rpc';
import type {
  ConversationView,
  MessageView,
  OfferView,
  ReportReason,
} from './messaging';

/** Carried in `RpcErrorBody.code` (see `../rpc/rpc.ts`). */
export type MessagingErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  /** Unknown conversation, message or offer, or one the caller isn't part of; or an unknown item. */
  | 'NOT_FOUND'
  /** Starting a conversation (and booking an offer) needs a verified email. */
  | 'EMAIL_NOT_VERIFIED'
  /** Lenders can't start conversations about their own items. */
  | 'OWN_ITEM'
  /** The item isn't open for new conversations or offers (not ACTIVE). */
  | 'ITEM_UNAVAILABLE'
  /** The item is deleted or an account erased: the conversation is read-only. */
  | 'CONVERSATION_CLOSED'
  /** The action doesn't fit the caller's side, e.g. a renter sending an offer. */
  | 'INVALID_STATE'
  /** The offer was used, withdrawn, replaced or has expired. */
  | 'OFFER_UNAVAILABLE'
  /** An offer's rent can't be above what the rate card charges for the period. */
  | 'PRICE_ABOVE_LIST'
  /** The offer's period breaks the booking rules (see `BookingsErrorCode`). */
  | 'INVALID_PERIOD'
  /** The offer's period is already held by another booking. */
  | 'SLOT_TAKEN'
  | 'INTERNAL';

// --- Requests ---------------------------------------------------------------

export interface StartConversationRequest {
  itemId: string;
}

export interface ConversationRef {
  conversationId: string;
}

export interface ListConversationsRequest {
  cursor?: string;
  limit?: number;
}

/** Most recent activity first. */
export interface ListConversationsResponse {
  conversations: ConversationView[];
  nextCursor: string | null;
}

export interface ListMessagesRequest extends ConversationRef {
  /** From the previous page's `nextCursor`: older messages. */
  cursor?: string;
  limit?: number;
}

/** Newest first; `nextCursor` leads to older ones. */
export interface ListMessagesResponse {
  messages: MessageView[];
  nextCursor: string | null;
}

export interface SendMessageRequest extends ConversationRef {
  /** A new random UUID per message; sending it again returns the same message. */
  messageId: string;
  text: string;
}

export interface MarkReadResponse {
  readAt: string;
}

export interface ReportMessageRequest {
  messageId: string;
  reason: ReportReason;
}

export interface UnreadCountResponse {
  /** Unread messages across all the caller's conversations. */
  total: number;
}

export interface SendOfferRequest
  extends ConversationRef,
    Omit<ItemPeriodRequest, 'itemId'> {
  /** A new random UUID per offer; sending it again returns the same offer. */
  offerId: string;
  rentCents: number;
}

export interface OfferRef {
  offerId: string;
}

export interface BookOfferRequest extends OfferRef {
  /** A new random UUID, as for a booking request. */
  bookingId: string;
}

/** Messaging's part of `GET /me/export`. */
export interface MessagingDataExport {
  exportedAt: string;
  conversations: Array<{
    id: string;
    itemId: string;
    itemTitle: string;
    role: 'RENTER' | 'LENDER';
    createdAt: string;
    /** The caller's own messages in it, oldest first, as written. */
    myMessages: Array<{ id: string; text: string | null; sentAt: string }>;
  }>;
  /** Offers the caller sent or received. */
  offers: OfferView[];
  reports: Array<{ messageId: string; reason: ReportReason; createdAt: string }>;
}

// --- Patterns ---------------------------------------------------------------

export const MessagingRpc = {
  start: 'messaging.conversations.start',
  listMine: 'messaging.conversations.list',
  get: 'messaging.conversations.get',
  messages: 'messaging.messages.list',
  send: 'messaging.messages.send',
  markRead: 'messaging.conversations.read',
  unreadCount: 'messaging.unread.count',
  report: 'messaging.messages.report',
  sendOffer: 'messaging.offers.send',
  withdrawOffer: 'messaging.offers.withdraw',
  bookOffer: 'messaging.offers.book',
  exportMe: 'messaging.me.export',
} as const;

/** Pattern → request/response types, for typed clients and handlers. */
export interface MessagingRpcContract {
  [MessagingRpc.start]: {
    request: StartConversationRequest;
    response: ConversationView;
  };
  [MessagingRpc.listMine]: {
    request: ListConversationsRequest;
    response: ListConversationsResponse;
  };
  [MessagingRpc.get]: { request: ConversationRef; response: ConversationView };
  [MessagingRpc.messages]: {
    request: ListMessagesRequest;
    response: ListMessagesResponse;
  };
  [MessagingRpc.send]: { request: SendMessageRequest; response: MessageView };
  [MessagingRpc.markRead]: {
    request: ConversationRef;
    response: MarkReadResponse;
  };
  [MessagingRpc.unreadCount]: {
    request: Record<string, never>;
    response: UnreadCountResponse;
  };
  [MessagingRpc.report]: { request: ReportMessageRequest; response: void };
  [MessagingRpc.sendOffer]: { request: SendOfferRequest; response: OfferView };
  [MessagingRpc.withdrawOffer]: { request: OfferRef; response: OfferView };
  [MessagingRpc.bookOffer]: { request: BookOfferRequest; response: BookingView };
  [MessagingRpc.exportMe]: {
    request: Record<string, never>;
    response: MessagingDataExport;
  };
}

export type MessagingRpcPattern = keyof MessagingRpcContract;
