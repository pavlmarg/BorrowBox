import type {
  BookingCancelledV1Payload,
  BookingDeclinedV1Payload,
  BookingExpiredV1Payload,
  BookingSnapshotV1,
  ConversationUnreadV1Payload,
  EmailKind,
  OfferSentV1Payload,
  PaymentFailedV1Payload,
  PaymentRefundedV1Payload,
  PaymentSettledV1Payload,
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
  /** The renter's service fee (ADR-0020). */
  feeCents?: number;
  /** What the renter pays (`payment.failed`). */
  chargeCents?: number;
  /** Money sent back or paid out (`payment.refunded`, `payment.settled`). */
  amountCents?: number;
  /** When an accepted booking expires unless paid. */
  payBy?: string;
  expiresAt?: string;
  reason?: string;
  unreadCount?: number;
}

export interface PlannedEmail {
  kind: EmailKind;
  recipientId: string;
  data: EmailData;
  /** Not sent before this much time has passed (default: at once). */
  delayMs?: number;
}

/**
 * An erasure's cancellations wait this long, so Notifications has processed
 * the same `user.deletion_requested` first and the erased person's copy is
 * dropped instead of sent (the events can arrive in either order).
 */
export const ERASURE_EMAIL_DELAY_MS = 10 * 60 * 1000;

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
    ...(b.feeCents !== undefined ? { feeCents: b.feeCents } : {}),
    ...(b.payBy ? { payBy: b.payBy } : {}),
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

/** booking.paid.v1: it goes ahead; both arrange where and when to meet. */
export function onPaid(b: Booking): PlannedEmail[] {
  return [toRenter('BOOKING_PAID', b), toLender('BOOKING_PAID', b)];
}

/** payment.failed.v1: the renter may try again until the pay-by time. */
export function onPaymentFailed(p: PaymentFailedV1Payload): PlannedEmail[] {
  return [
    {
      kind: 'PAYMENT_FAILED',
      recipientId: p.renterId,
      data: {
        otherId: p.lenderId,
        itemTitle: p.itemTitle,
        bookingId: p.bookingId,
        chargeCents: p.amountCents,
        payBy: p.payBy,
      },
    },
  ];
}

/** payment.refunded.v1: the renter's refund is on its way (ADR-0021). */
export function onRefunded(p: PaymentRefundedV1Payload): PlannedEmail[] {
  return [
    {
      kind: 'REFUND_ISSUED',
      recipientId: p.renterId,
      data: {
        otherId: p.lenderId,
        itemTitle: p.itemTitle,
        bookingId: p.bookingId,
        amountCents: p.amountCents,
      },
    },
  ];
}

/** payment.settled.v1: the deposit goes back, the lender is paid (each when not 0). */
export function onSettled(p: PaymentSettledV1Payload): PlannedEmail[] {
  const base = { itemTitle: p.itemTitle, bookingId: p.bookingId };
  const emails: PlannedEmail[] = [];
  if (p.depositRefundCents > 0) {
    emails.push({
      kind: 'DEPOSIT_RETURNED',
      recipientId: p.renterId,
      data: { ...base, otherId: p.lenderId, amountCents: p.depositRefundCents },
    });
  }
  if (p.payoutCents > 0) {
    emails.push({
      kind: 'PAYOUT_SENT',
      recipientId: p.lenderId,
      data: { ...base, otherId: p.renterId, amountCents: p.payoutCents },
    });
  }
  return emails;
}

/** booking.confirmed.v1: both arrange where and when to meet (ADR-0015). */
export function onConfirmed(b: Booking): PlannedEmail[] {
  return [toRenter('BOOKING_CONFIRMED', b), toLender('BOOKING_CONFIRMED', b)];
}

export function onDeclined(b: BookingDeclinedV1Payload): PlannedEmail[] {
  return [toRenter('BOOKING_DECLINED', b, b.reason)];
}

/** The renter always; the lender too when they never answered, or it wasn't paid. */
export function onExpired(b: BookingExpiredV1Payload): PlannedEmail[] {
  return b.reason === 'NO_ANSWER' || b.reason === 'PAYMENT_TIMEOUT'
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
      // Either side may be the erased one: both are planned, and the erased
      // person's copy is dropped once they're forgotten (hence the delay).
      return [
        toRenter('BOOKING_CANCELLED', b, b.reason),
        toLender('BOOKING_CANCELLED', b, b.reason),
      ].map((e) => ({ ...e, delayMs: ERASURE_EMAIL_DELAY_MS }));
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
