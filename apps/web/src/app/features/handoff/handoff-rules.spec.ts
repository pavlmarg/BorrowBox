import type { BookingViewResponse } from '../../api/models';
import {
  canFileClaim,
  handoffActions,
  hasClaim,
  hasPhotos,
  needsAnswer,
} from './handoff-rules';

const START = '2026-12-01T10:00:00.000Z';
const OPENS = '2026-12-01T08:00:00.000Z';

function booking(over: Partial<BookingViewResponse> = {}): BookingViewResponse {
  const base = {
    id: 'b1',
    status: 'PAID',
    role: 'LENDER',
    start: START,
    end: '2026-12-02T10:00:00.000Z',
    reason: null,
    price: { depositCents: 5000 },
    handoff: {
      pickupOpensAt: OPENS,
      pickedUpAt: null,
      returnedAt: null,
      claimUntil: null,
      question: null,
      review: null,
    },
  };
  return {
    ...base,
    ...over,
    handoff: { ...base.handoff, ...over.handoff },
  } as unknown as BookingViewResponse;
}

const at = (iso: string) => new Date(iso);

describe('handoffActions', () => {
  it('offers the pickup before it opens, with its opening time', () => {
    expect(handoffActions(booking(), at('2026-12-01T07:00:00Z'))).toEqual([
      { phase: 'PICKUP', part: 'SHOW', opensAt: OPENS },
    ]);
  });

  it('opens the pickup 2 h before the start; the renter scans', () => {
    expect(handoffActions(booking({ role: 'RENTER' }), at(OPENS))).toEqual([
      { phase: 'PICKUP', part: 'SCAN', opensAt: null },
    ]);
  });

  it('works for free bookings (CONFIRMED) too', () => {
    expect(
      handoffActions(booking({ status: 'CONFIRMED' }), at(START)),
    ).toHaveLength(1);
  });

  it('offers the return while the item is out; the renter shows', () => {
    const out = booking({ status: 'PICKED_UP', role: 'RENTER' });
    expect(handoffActions(out, at(START))).toEqual([
      { phase: 'RETURN', part: 'SHOW', opensAt: null },
    ]);
  });

  it('offers both while the pickup waits for an admin', () => {
    const review = booking({
      handoff: { review: 'PICKUP_UNCONFIRMED' } as never,
    });
    expect(handoffActions(review, at(START)).map((a) => a.phase)).toEqual([
      'PICKUP',
      'RETURN',
    ]);
  });

  it.each([
    'REQUESTED',
    'ACCEPTED',
    'RETURNED',
    'DISPUTED',
    'COMPLETED',
    'EXPIRED',
    'CANCELLED',
  ] as const)('offers nothing while %s', (status) => {
    expect(handoffActions(booking({ status }), at(START))).toEqual([]);
  });
});

describe('needsAnswer', () => {
  const question = (myAnswer: 'YES' | null) =>
    booking({
      handoff: {
        question: {
          phase: 'PICKUP',
          myAnswer,
          otherAnswered: false,
          decideAt: START,
        },
      } as never,
    });

  it('asks while the caller has not answered', () => {
    expect(needsAnswer(question(null))).toBe(true);
  });

  it('stops once answered, and without a question', () => {
    expect(needsAnswer(question('YES'))).toBe(false);
    expect(needsAnswer(booking())).toBe(false);
  });
});

describe('hasPhotos / hasClaim', () => {
  it('loads photos from the confirmation on, and after a missed pickup', () => {
    expect(hasPhotos(booking({ status: 'REQUESTED' }))).toBe(false);
    expect(hasPhotos(booking({ status: 'CONFIRMED' }))).toBe(true);
    expect(hasPhotos(booking({ status: 'COMPLETED' }))).toBe(true);
    expect(
      hasPhotos(booking({ status: 'EXPIRED', reason: 'NO_HANDOFF' })),
    ).toBe(true);
    expect(
      hasPhotos(booking({ status: 'EXPIRED', reason: 'PAYMENT_TIMEOUT' })),
    ).toBe(false);
  });

  it('loads a claim only from the return on', () => {
    expect(hasClaim(booking({ status: 'PICKED_UP' }))).toBe(false);
    expect(hasClaim(booking({ status: 'RETURNED' }))).toBe(true);
    expect(hasClaim(booking({ status: 'DISPUTED' }))).toBe(true);
    expect(hasClaim(booking({ status: 'COMPLETED' }))).toBe(true);
  });
});

describe('canFileClaim', () => {
  const until = '2026-12-04T10:00:00.000Z';
  const returned = (over: Partial<BookingViewResponse> = {}) =>
    booking({
      status: 'RETURNED',
      ...over,
      handoff: { claimUntil: until } as never,
    });
  const before = at('2026-12-04T09:59:00Z');

  it('lets the lender report damage inside the claim window', () => {
    expect(canFileClaim(returned(), false, before)).toBe(true);
  });

  it('refuses the renter, after the window, a second claim, and no deposit', () => {
    expect(canFileClaim(returned({ role: 'RENTER' }), false, before)).toBe(
      false,
    );
    expect(canFileClaim(returned(), false, at(until))).toBe(false);
    expect(canFileClaim(returned(), true, before)).toBe(false);
    expect(
      canFileClaim(
        returned({ price: { depositCents: 0 } as never }),
        false,
        before,
      ),
    ).toBe(false);
  });
});
