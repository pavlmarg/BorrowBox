import { defineEvent } from '../events/envelope';

/**
 * Messaging events (ADR-0017, ADR-0018). Never message text: consumers know
 * that something was said, not what.
 */

export interface MessageSentV1Payload {
  messageId: string;
  conversationId: string;
  itemId: string;
  senderId: string;
  recipientId: string;
  sentAt: string;
}
export const MessageSentV1 = defineEvent<MessageSentV1Payload>()(
  'message.sent',
  1,
);

/**
 * The recipient hasn't read a message 2 minutes after it was sent, and
 * wasn't reminded about this conversation in the last 30 minutes.
 */
export interface ConversationUnreadV1Payload {
  conversationId: string;
  itemId: string;
  itemTitle: string;
  recipientId: string;
  senderId: string;
  unreadCount: number;
}
export const ConversationUnreadV1 = defineEvent<ConversationUnreadV1Payload>()(
  'conversation.unread',
  1,
);

/** The lender offered a price for a period (ADR-0018). */
export interface OfferSentV1Payload {
  offerId: string;
  conversationId: string;
  itemId: string;
  itemTitle: string;
  lenderId: string;
  renterId: string;
  start: string;
  end: string;
  rentCents: number;
  depositCents: number;
  expiresAt: string;
}
export const OfferSentV1 = defineEvent<OfferSentV1Payload>()('offer.sent', 1);

export const OFFER_WITHDRAW_REASONS = [
  'LENDER',
  'REPLACED',
  'ITEM_DELETED',
  'ACCOUNT_DELETED',
] as const;
export type OfferWithdrawReason = (typeof OFFER_WITHDRAW_REASONS)[number];

/** An open offer can no longer be used: withdrawn, replaced, or its item or a person gone. */
export interface OfferWithdrawnV1Payload {
  offerId: string;
  conversationId: string;
  itemId: string;
  lenderId: string;
  renterId: string;
  reason: OfferWithdrawReason;
}
export const OfferWithdrawnV1 = defineEvent<OfferWithdrawnV1Payload>()(
  'offer.withdrawn',
  1,
);
