import { BOOKING_STATUSES, type BookingStatus } from '@borrowbox/contracts';
import {
  assertTransition,
  canTransition,
  IllegalTransitionError,
} from './booking-state';

/** Every arrow of ARCHITECTURE.md §4 with ADR-0015's changes, and no other. */
const ALLOWED: Array<[BookingStatus, BookingStatus]> = [
  ['REQUESTED', 'ACCEPTED'],
  ['REQUESTED', 'CONFIRMED'],
  ['REQUESTED', 'DECLINED'],
  ['REQUESTED', 'EXPIRED'],
  ['REQUESTED', 'CANCELLED'],
  ['ACCEPTED', 'PAID'],
  ['ACCEPTED', 'EXPIRED'],
  ['ACCEPTED', 'CANCELLED'],
  ['CONFIRMED', 'CANCELLED'],
  ['CONFIRMED', 'PICKED_UP'],
  ['PAID', 'CANCELLED'],
  ['PAID', 'PICKED_UP'],
  ['PICKED_UP', 'RETURNED'],
  ['RETURNED', 'COMPLETED'],
  ['RETURNED', 'DISPUTED'],
  ['DISPUTED', 'COMPLETED'],
];

describe('booking state machine', () => {
  const allowed = new Set(ALLOWED.map(([from, to]) => `${from}>${to}`));
  const everyPair = BOOKING_STATUSES.flatMap((from) =>
    BOOKING_STATUSES.map((to) => [from, to] as const),
  );

  it.each(everyPair)('%s → %s matches §4', (from, to) => {
    expect(canTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
  });

  it('has final states with no way out', () => {
    for (const final of [
      'DECLINED',
      'EXPIRED',
      'CANCELLED',
      'COMPLETED',
    ] as const) {
      expect(BOOKING_STATUSES.filter((to) => canTransition(final, to))).toEqual(
        [],
      );
    }
  });

  it('throws on an illegal transition', () => {
    expect(() => assertTransition('DECLINED', 'ACCEPTED')).toThrow(
      IllegalTransitionError,
    );
    expect(() => assertTransition('REQUESTED', 'ACCEPTED')).not.toThrow();
  });
});
