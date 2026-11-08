import type { BookingSnapshotV1 } from '@borrowbox/contracts';
import {
  ERASURE_EMAIL_DELAY_MS,
  onAccepted,
  onCancelled,
  onConfirmed,
  onDeclined,
  onExpired,
  onPaid,
  onPaymentFailed,
  onRequested,
} from './plan';

const booking: BookingSnapshotV1 = {
  bookingId: '00000000-0000-4000-8000-000000000001',
  itemId: '00000000-0000-4000-8000-000000000002',
  itemTitle: 'Drill',
  lenderId: 'lender',
  renterId: 'renter',
  start: '2026-11-01T10:00:00.000Z',
  end: '2026-11-01T12:00:00.000Z',
  rentCents: 400,
  depositCents: 5000,
};

const who = (emails: Array<{ kind: string; recipientId: string }>) =>
  emails.map((e) => `${e.kind}>${e.recipientId}`);

describe('which booking emails go to whom (N1)', () => {
  it('asks the lender about a request, unless it came from their own offer', () => {
    expect(who(onRequested(booking))).toEqual(['BOOKING_REQUESTED>lender']);
    expect(onRequested({ ...booking, offerId: 'offer' })).toEqual([]);
  });

  it('tells the renter about an acceptance, and the lender that their offer was booked', () => {
    expect(who(onAccepted(booking))).toEqual(['BOOKING_ACCEPTED>renter']);
    expect(who(onAccepted({ ...booking, offerId: 'offer' }))).toEqual([
      'BOOKING_ACCEPTED>renter',
      'OFFER_BOOKED>lender',
    ]);
  });

  it('tells both to arrange the meeting once confirmed', () => {
    expect(who(onConfirmed(booking))).toEqual([
      'BOOKING_CONFIRMED>renter',
      'BOOKING_CONFIRMED>lender',
    ]);
  });

  it('tells the renter about a decline, with its reason', () => {
    const [email] = onDeclined({ ...booking, reason: 'OVERLAP' });
    expect(email).toMatchObject({
      kind: 'BOOKING_DECLINED',
      recipientId: 'renter',
      data: { otherId: 'lender', reason: 'OVERLAP' },
    });
  });

  it('tells the lender too when a request expired unanswered', () => {
    expect(who(onExpired({ ...booking, reason: 'NO_ANSWER' }))).toEqual([
      'BOOKING_EXPIRED>renter',
      'BOOKING_EXPIRED>lender',
    ]);
    expect(who(onExpired({ ...booking, reason: 'STARTED' }))).toEqual([
      'BOOKING_EXPIRED>renter',
    ]);
    // Unpaid in time: the lender learns it won't go ahead too.
    expect(who(onExpired({ ...booking, reason: 'PAYMENT_TIMEOUT' }))).toEqual([
      'BOOKING_EXPIRED>renter',
      'BOOKING_EXPIRED>lender',
    ]);
  });

  it('tells both people once a booking is paid', () => {
    expect(who(onPaid(booking))).toEqual([
      'BOOKING_PAID>renter',
      'BOOKING_PAID>lender',
    ]);
  });

  it('tells the renter a payment failed, with what to pay and by when', () => {
    const [email] = onPaymentFailed({
      bookingId: booking.bookingId,
      renterId: 'renter',
      lenderId: 'lender',
      itemTitle: 'Drill',
      amountCents: 7200,
      payBy: '2026-11-01T09:00:00.000Z',
    });
    expect(email).toEqual({
      kind: 'PAYMENT_FAILED',
      recipientId: 'renter',
      data: {
        otherId: 'lender',
        itemTitle: 'Drill',
        bookingId: booking.bookingId,
        chargeCents: 7200,
        payBy: '2026-11-01T09:00:00.000Z',
      },
    });
  });

  it('carries the fee and the pay-by time of an accepted booking', () => {
    const [email] = onAccepted({
      ...booking,
      feeCents: 200,
      payBy: '2026-11-01T09:00:00.000Z',
    });
    expect(email.data).toMatchObject({
      feeCents: 200,
      payBy: '2026-11-01T09:00:00.000Z',
    });
  });

  it.each([
    ['RENTER', ['BOOKING_CANCELLED>lender']],
    ['LENDER', ['BOOKING_CANCELLED>renter']],
    ['ITEM_DELETED', ['BOOKING_CANCELLED>renter']],
    [
      'ACCOUNT_DELETED',
      ['BOOKING_CANCELLED>renter', 'BOOKING_CANCELLED>lender'],
    ],
  ] as const)('a cancellation by %s reaches %p', (reason, expected) => {
    expect(who(onCancelled({ ...booking, reason }))).toEqual(expected);
  });

  it("delays an erasure's cancellations until the erasure is processed", () => {
    for (const email of onCancelled({
      ...booking,
      reason: 'ACCOUNT_DELETED',
    })) {
      expect(email.delayMs).toBe(ERASURE_EMAIL_DELAY_MS);
    }
    for (const email of onCancelled({ ...booking, reason: 'RENTER' })) {
      expect(email.delayMs).toBeUndefined();
    }
  });

  it('never stores names or text, only ids, times and amounts', () => {
    const [email] = onRequested(booking);
    expect(Object.keys(email.data).sort()).toEqual([
      'bookingId',
      'depositCents',
      'end',
      'itemTitle',
      'otherId',
      'rentCents',
      'start',
    ]);
  });
});
