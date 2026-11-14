import {
  bookingFees,
  maskContacts,
  type ConversationView,
  type MessageView,
  type OfferStatus,
  type OfferView,
} from '@borrowbox/contracts';
import type {
  ConversationRow,
  MessageRow,
  OfferRow,
} from './messaging.repository';

/** The reader's side of a conversation. */
export function roleIn(
  c: Pick<ConversationRow, 'renter_id'>,
  userId: string,
): 'RENTER' | 'LENDER' {
  return c.renter_id === userId ? 'RENTER' : 'LENDER';
}

/** An open offer past its time shows as `EXPIRED`; the row stays `OPEN` until replaced. */
export function offerStatus(o: OfferRow, now = new Date()): OfferStatus {
  return o.status === 'OPEN' && o.expires_at.getTime() <= now.getTime()
    ? 'EXPIRED'
    : o.status;
}

export function toOfferView(o: OfferRow, now = new Date()): OfferView {
  const fees = bookingFees(o.rent_cents, o.deposit_cents);
  return {
    id: o.id,
    conversationId: o.conversation_id,
    itemId: o.item_id,
    start: o.start.toISOString(),
    end: o.end.toISOString(),
    rentCents: o.rent_cents,
    depositCents: o.deposit_cents,
    // As the renter would pay if they booked it now (ADR-0020).
    feeCents: fees.renterFeeCents,
    totalCents: fees.chargeCents,
    listRentCents: o.list_rent_cents,
    status: offerStatus(o, now),
    expiresAt: o.expires_at.toISOString(),
    bookingId: o.booking_id,
    createdAt: o.created_at.toISOString(),
  };
}

/**
 * The message as `readerId` sees it: contact details masked unless the two
 * have a booking that went ahead, or the reader wrote it (ADR-0017).
 */
export function toMessageView(
  m: MessageRow,
  readerId: string,
  unlocked: boolean,
): MessageView {
  const mine = m.sender_id === readerId;
  return {
    id: m.id,
    conversationId: m.conversation_id,
    kind: m.kind,
    senderId: m.sender_id,
    mine,
    text:
      m.body === null ? null : mine || unlocked ? m.body : maskContacts(m.body),
    deleted: m.deleted,
    systemCode: m.system_code,
    bookingId: m.booking_id,
    offer: m.offer ? toOfferView(m.offer) : null,
    sentAt: m.created_at.toISOString(),
  };
}

export function toConversationView(
  c: ConversationRow,
  readerId: string,
  extra: {
    lastMessage: MessageRow | null;
    unreadCount: number;
    openOffer: OfferRow | null;
  },
): ConversationView {
  const role = roleIn(c, readerId);
  const otherReadAt = role === 'RENTER' ? c.lender_read_at : c.renter_read_at;
  return {
    id: c.id,
    itemId: c.item_id,
    itemTitle: c.item_title,
    role,
    other:
      role === 'RENTER'
        ? {
            userId: c.lender_id,
            displayName: c.lender_name,
            photo: c.lender_photo ?? null,
          }
        : {
            userId: c.renter_id,
            displayName: c.renter_name,
            photo: c.renter_photo ?? null,
          },
    lastMessage: extra.lastMessage
      ? toMessageView(extra.lastMessage, readerId, c.unlocked)
      : null,
    lastMessageAt: c.last_message_at.toISOString(),
    unreadCount: extra.unreadCount,
    otherReadAt: otherReadAt?.toISOString() ?? null,
    closed: c.closed,
    openOffer: extra.openOffer ? toOfferView(extra.openOffer) : null,
    createdAt: c.created_at.toISOString(),
  };
}
