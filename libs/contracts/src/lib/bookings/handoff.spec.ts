import {
  claimUntil,
  confirmRoundAt,
  handoffBase,
  handoffDecideAt,
  pickupOpensAt,
  pickupOutcome,
  returnOutcome,
  type HandoffAnswer,
} from './handoff';

const at = (iso: string) => new Date(iso);
const answers = (
  lender: HandoffAnswer | null,
  renter: HandoffAnswer | null,
) => ({
  lender,
  renter,
});

describe('handoff timings', () => {
  const start = at('2026-12-01T10:00:00Z');
  const end = at('2026-12-01T13:00:00Z');

  it('opens the pickup 2 hours before the start', () => {
    expect(pickupOpensAt(start)).toEqual(at('2026-12-01T08:00:00Z'));
  });

  it('counts the pickup rounds from the start', () => {
    const base = handoffBase('PICKUP', { start, end, pickedUpAt: null });
    expect(confirmRoundAt(base, 1)).toEqual(at('2026-12-01T12:00:00Z'));
    expect(confirmRoundAt(base, 2)).toEqual(at('2026-12-02T10:00:00Z'));
    expect(confirmRoundAt(base, 3)).toEqual(at('2026-12-03T10:00:00Z'));
    expect(handoffDecideAt(base)).toEqual(at('2026-12-04T10:00:00Z'));
  });

  it('counts the return rounds from the end', () => {
    const base = handoffBase('RETURN', {
      start,
      end,
      pickedUpAt: at('2026-12-01T09:00:00Z'),
    });
    expect(base).toEqual(end);
  });

  it('counts the return rounds from a pickup confirmed after the end', () => {
    const late = at('2026-12-03T15:30:00Z');
    expect(handoffBase('RETURN', { start, end, pickedUpAt: late })).toEqual(
      late,
    );
  });

  it('closes the claim window 48 hours after the return', () => {
    expect(claimUntil(at('2026-12-01T12:15:00Z'))).toEqual(
      at('2026-12-03T12:15:00Z'),
    );
  });
});

describe('pickupOutcome', () => {
  it.each([
    // lender, renter, before the deadline, at the deadline
    ['YES', 'YES', 'PICKED_UP', 'PICKED_UP'],
    ['NO', 'NO', 'NO_HANDOFF', 'NO_HANDOFF'],
    ['YES', 'NO', 'REVIEW', 'REVIEW'],
    ['NO', 'YES', 'REVIEW', 'REVIEW'],
    ['YES', null, 'WAIT', 'REVIEW'],
    [null, 'YES', 'WAIT', 'REVIEW'],
    ['NO', null, 'WAIT', 'NO_HANDOFF'],
    [null, 'NO', 'WAIT', 'NO_HANDOFF'],
    [null, null, 'WAIT', 'NO_HANDOFF'],
  ] as const)(
    'lender %s, renter %s → %s, then %s',
    (lender, renter, before, due) => {
      expect(pickupOutcome(answers(lender, renter), false)).toBe(before);
      expect(pickupOutcome(answers(lender, renter), true)).toBe(due);
    },
  );
});

describe('returnOutcome', () => {
  it.each([
    ['YES', 'YES', 'RETURNED', 'RETURNED'],
    ['YES', 'NO', 'RETURNED', 'RETURNED'],
    ['YES', null, 'RETURNED', 'RETURNED'],
    ['NO', 'YES', 'REVIEW', 'REVIEW'],
    ['NO', null, 'REVIEW', 'REVIEW'],
    [null, 'YES', 'WAIT', 'REVIEW'],
    [null, 'NO', 'WAIT', 'REVIEW'],
    [null, null, 'WAIT', 'REVIEW'],
  ] as const)(
    'lender %s, renter %s → %s, then %s',
    (lender, renter, before, due) => {
      expect(returnOutcome(answers(lender, renter), false)).toBe(before);
      expect(returnOutcome(answers(lender, renter), true)).toBe(due);
    },
  );
});
