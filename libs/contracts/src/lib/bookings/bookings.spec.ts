import {
  BookingAcceptedV1,
  BookingCancelledV1,
  BookingCompletedV1,
  BookingConfirmedV1,
  BookingDeclinedV1,
  BookingDisputedV1,
  BookingExpiredV1,
  BookingPaidV1,
  BookingRequestedV1,
} from './events';
import { TIMESTAMP_OFFSET_PATTERN, hoursBetween, isWholeHour } from './periods';

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

  it.each([
    ['2026-11-01T10:00:00.000Z', true],
    ['2026-11-01T10:00:00z', true],
    ['2026-11-01T12:00:00+02:00', true],
    ['2026-11-01T12:00:00+0200', true],
    ['2026-11-01T05:00:00-05:00', true],
    ['2026-11-01T10:00:00', false],
    ['2026-11-01T10:00', false],
    ['2026-11-01', false],
  ])('%s names its offset: %s', (iso, expected) => {
    expect(TIMESTAMP_OFFSET_PATTERN.test(iso)).toBe(expected);
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
        BookingPaidV1,
        BookingCompletedV1,
        BookingDisputedV1,
      ].map((e) => e.routingKey),
    ).toEqual([
      'booking.requested.v1',
      'booking.accepted.v1',
      'booking.confirmed.v1',
      'booking.declined.v1',
      'booking.expired.v1',
      'booking.cancelled.v1',
      'booking.paid.v1',
      'booking.completed.v1',
      'booking.disputed.v1',
    ]);
  });
});
