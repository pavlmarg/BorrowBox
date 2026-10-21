import type {
  BookingCancelledV1Payload,
  BookingDeclinedV1Payload,
  BookingExpiredV1Payload,
  BookingSnapshotV1,
  ConversationUnreadV1Payload,
  EmailKind,
  OfferSentV1Payload,
} from '@borrowbox/contracts';

/**
 * What an email needs, stored with its job. Ids, the item title, times and
 * amounts: never message text, never names (looked up when sending, so a
 * deleted person's name is never used).
 */
export interface EmailData {
  /** The person the email is about; their name is looked up when sending. */
  otherId: string;
  itemTitle: string;
  bookingId?: string;
  conversationId?: string;
  offerId?: string;
  start?: string;
  end?: string;
  rentCents?: number;
  depositCents?: number;
  expiresAt?: string;
  reason?: string;
  unreadCount?: number;
}

export interface PlannedEmail {
  kind: EmailKind;
  recipientId: string;
  data: EmailData;
}

type Booking = BookingSnapshotV1;

function bookingData(b: Booking, otherId: string, reason?: string): EmailData {
  return {
    otherId,
    itemTitle: b.itemTitle,
    bookingId: b.bookingId,
    start: b.start,
    end: b.end,
    rentCents: b.rentCents,
    depositCents: b.depositCents,
    ...(b.offerId ? { offerId: b.offerId } : {}),
    ...(reason ? { reason } : {}),
  };
}

const toLender = (kind: EmailKind, b: Booking, reason?: string) => ({
  kind,
  recipientId: b.lenderId,
  data: bookingData(b, b.renterId, reason),
});
const toRenter = (kind: EmailKind, b: Booking, reason?: string) => ({
  kind,
  recipientId: b.renterId,
  data: bookingData(b, b.lenderId, reason),
});

/** booking.requested.v1: the lender is asked, unless the booking came from their own offer. */
export function onRequested(b: Booking): PlannedEmail[] {
  return b.offerId ? [] : [toLender('BOOKING_REQUESTED', b)];
}

/** booking.accepted.v1: the renter hears; for an offer, the lender learns it was booked. */
export function onAccepted(b: Booking): PlannedEmail[] {
  return b.offerId
    ? [toRenter('BOOKING_ACCEPTED', b), toLender('OFFER_BOOKED', b)]
    : [toRenter('BOOKING_ACCEPTED', b)];
}

/** booking.confirmed.v1: both arrange where and when to meet (ADR-0015). */
export function onConfirmed(b: Booking): PlannedEmail[] {
  return [toRenter('BOOKING_CONFIRMED', b), toLender('BOOKING_CONFIRMED', b)];
}

export function onDeclined(b: BookingDeclinedV1Payload): PlannedEmail[] {
  return [toRenter('BOOKING_DECLINED', b, b.reason)];
}

/** The renter always; the lender too when they never answered. */
export function onExpired(b: BookingExpiredV1Payload): PlannedEmail[] {
  return b.reason === 'NO_ANSWER'
    ? [
        toRenter('BOOKING_EXPIRED', b, b.reason),
        toLender('BOOKING_EXPIRED', b, b.reason),
      ]
    : [toRenter('BOOKING_EXPIRED', b, b.reason)];
}

/** The other side of whoever cancelled; for a deleted item, the renter. */
export function onCancelled(b: BookingCancelledV1Payload): PlannedEmail[] {
  switch (b.reason) {
    case 'RENTER':
      return [toLender('BOOKING_CANCELLED', b, b.reason)];
    case 'LENDER':
    case 'ITEM_DELETED':
      return [toRenter('BOOKING_CANCELLED', b, b.reason)];
    case 'ACCOUNT_DELETED':
      // The erased person is forgotten, so only the other one gets it.
      return [
        toRenter('BOOKING_CANCELLED', b, b.reason),
        toLender('BOOKING_CANCELLED', b, b.reason),
      ];
  }
}

export function onOfferSent(o: OfferSentV1Payload): PlannedEmail[] {
  return [
    {
      kind: 'OFFER_RECEIVED',
      recipientId: o.renterId,
      data: {
        otherId: o.lenderId,
        itemTitle: o.itemTitle,
        offerId: o.offerId,
        conversationId: o.conversationId,
        start: o.start,
        end: o.end,
        rentCents: o.rentCents,
        depositCents: o.depositCents,
        expiresAt: o.expiresAt,
      },
    },
  ];
}

export function onUnread(u: ConversationUnreadV1Payload): PlannedEmail[] {
  return [
    {
      kind: 'MESSAGES_UNREAD',
      recipientId: u.recipientId,
      data: {
        otherId: u.senderId,
        itemTitle: u.itemTitle,
        conversationId: u.conversationId,
        unreadCount: u.unreadCount,
      },
    },
  ];
}
