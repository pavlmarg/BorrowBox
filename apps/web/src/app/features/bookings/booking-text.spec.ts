import { HttpErrorResponse } from '@angular/common/http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOOKING_CANCEL_REASONS,
  BOOKING_DECLINE_REASONS,
  BOOKING_EXPIRE_REASONS,
  BOOKING_STATUSES,
} from '@borrowbox/contracts';
import { booking } from '../../../testing/bookings';
import {
  BOOKING_ERROR_CODES,
  CURRENT_STATUSES,
  PAST_STATUSES,
  bookingErrorCode,
  bookingErrorKey,
  canCancel,
  durationParts,
  timeLeft,
  unitParts,
} from './booking-text';

const refusal = (code: string, status = 409) =>
  new HttpErrorResponse({
    status,
    error: { statusCode: status, code, message: 'refused' },
  });

describe('booking texts', () => {
  it('maps Bookings’ refusals to its own messages, others to the shared ones', () => {
    expect(bookingErrorCode(refusal('SLOT_TAKEN'))).toBe('SLOT_TAKEN');
    expect(bookingErrorKey('SLOT_TAKEN')).toBe('bookings.errors.SLOT_TAKEN');
    expect(bookingErrorCode(refusal('RATE_LIMITED', 429))).toBe('RATE_LIMITED');
    expect(bookingErrorKey('RATE_LIMITED')).toBe('errors.RATE_LIMITED');
    expect(bookingErrorCode(refusal('SOMETHING_NEW'))).toBe('UNKNOWN');
  });

  it('splits every status into current or past', () => {
    expect([...CURRENT_STATUSES, ...PAST_STATUSES].sort()).toEqual(
      [...BOOKING_STATUSES].sort(),
    );
  });

  it('names units and lengths, largest first', () => {
    expect(unitParts({ MONTH: 0, WEEK: 1, DAY: 2, HOUR: 0 })).toEqual([
      { key: 'bookings.units.WEEK.one', n: 1 },
      { key: 'bookings.units.DAY.other', n: 2 },
    ]);
    expect(durationParts(49)).toEqual([
      { key: 'bookings.units.DAY.other', n: 2 },
      { key: 'bookings.units.HOUR.one', n: 1 },
    ]);
    expect(durationParts(3)).toEqual([
      { key: 'bookings.units.HOUR.other', n: 3 },
    ]);
  });

  it('counts down, never below zero', () => {
    const now = Date.parse('2026-11-09T10:00:00Z');
    expect(timeLeft('2026-11-09T12:05:07Z', now)).toMatchObject({
      hours: 2,
      minutes: 5,
      seconds: 7,
    });
    expect(timeLeft('2026-11-09T09:00:00Z', now).ms).toBe(0);
  });

  it('allows cancelling accepted, confirmed and paid bookings before the start', () => {
    const before = Date.parse('2026-11-09T10:00:00Z');
    const after = Date.parse('2026-11-30T10:00:00Z');
    expect(canCancel(booking({ status: 'PAID' }), before)).toBe(true);
    expect(canCancel(booking({ status: 'PAID' }), after)).toBe(false);
    expect(canCancel(booking({ status: 'REQUESTED' }), before)).toBe(false);
  });

  describe.each(['el', 'en'])('%s translations', (lang) => {
    const tree = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../public/i18n', `${lang}.json`),
        'utf8',
      ),
    );
    const get = (key: string) =>
      key.split('.').reduce((node, part) => node?.[part], tree);

    it('has every status, state, reason and error', () => {
      const keys = [
        ...BOOKING_STATUSES.flatMap((s) => [
          `bookings.status.${s}`,
          `bookings.state.${s}.RENTER`,
          `bookings.state.${s}.LENDER`,
        ]),
        ...[
          ...BOOKING_DECLINE_REASONS.map((r) => `DECLINED_${r}`),
          ...BOOKING_CANCEL_REASONS.map((r) => `CANCELLED_${r}`),
          ...BOOKING_EXPIRE_REASONS.map((r) => `EXPIRED_${r}`),
        ].flatMap((r) => [
          `bookings.reason.${r}.RENTER`,
          `bookings.reason.${r}.LENDER`,
        ]),
        ...BOOKING_ERROR_CODES.map((c) => `bookings.errors.${c}`),
      ];
      expect(keys.filter((k) => typeof get(k) !== 'string')).toEqual([]);
    });
  });
});
