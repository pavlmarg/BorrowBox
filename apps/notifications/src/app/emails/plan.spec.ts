import type { BookingSnapshotV1 } from '@borrowbox/contracts';
import {
  onAccepted,
  onCancelled,
  onConfirmed,
  onDeclined,
  onExpired,
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
