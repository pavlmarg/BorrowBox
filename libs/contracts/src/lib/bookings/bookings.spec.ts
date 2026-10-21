import {
  BookingAcceptedV1,
  BookingCancelledV1,
  BookingConfirmedV1,
  BookingDeclinedV1,
  BookingExpiredV1,
  BookingRequestedV1,
} from './events';
import { hoursBetween, isWholeHour } from './periods';

describe('booking periods', () => {
  it.each([
    ['2026-11-01T10:00:00.000Z', true],
    ['2026-11-01T10:30:00.000Z', false],
    ['2026-11-01T10:00:01.000Z', false],
    ['2026-11-01T10:00:00.001Z', false],
  ])('isWholeHour(%s) is %s', (iso, expected) => {
    expect(isWholeHour(new Date(iso))).toBe(expected);
  });

  it('counts whole hours, across a daylight-saving change too', () => {
    // Athens leaves summer time at 04:00 local on 2026-10-25 (01:00 UTC).
    expect(
      hoursBetween(
        new Date('2026-10-24T21:00:00Z'),
        new Date('2026-10-25T21:00:00Z'),
      ),
    ).toBe(24);
  });
});

describe('booking events', () => {
  it('have versioned routing keys', () => {
    expect(
      [
        BookingRequestedV1,
        BookingAcceptedV1,
        BookingConfirmedV1,
        BookingDeclinedV1,
        BookingExpiredV1,
        BookingCancelledV1,
      ].map((e) => e.routingKey),
    ).toEqual([
      'booking.requested.v1',
      'booking.accepted.v1',
      'booking.confirmed.v1',
      'booking.declined.v1',
      'booking.expired.v1',
      'booking.cancelled.v1',
    ]);
  });
});
