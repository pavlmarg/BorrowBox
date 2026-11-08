import { bookingFees } from './fees';
import {
  cancellationPlan,
  chargeOf,
  settlementPlan,
  type PaidAmounts,
} from './refunds';

const HOUR = 3_600_000;
const start = new Date('2026-12-01T10:00:00.000Z');
const before = (hours: number) => new Date(start.getTime() - hours * HOUR);

/** €20 rent, €50 deposit, €2.00 fee, €1.50 lender fee: the renter paid €72.00. */
const paid: PaidAmounts = {
  rentCents: 2000,
  depositCents: 5000,
  feeCents: 200,
  lenderFeeCents: 150,
};

describe('cancellationPlan (ADR-0021)', () => {
  it('refunds everything when it is not the renter’s doing, or the payment came late', () => {
    for (const by of ['NOT_RENTER', 'LATE_PAYMENT'] as const) {
      expect(cancellationPlan(paid, { by })).toEqual({
        refundCents: 7200,
        lenderPayoutCents: 0,
        keptCents: 0,
      });
    }
  });

  it('keeps the service fee when the renter cancels more than 24 hours ahead', () => {
    expect(
      cancellationPlan(paid, { by: 'RENTER', cancelledAt: before(25), start }),
    ).toEqual({ refundCents: 7000, lenderPayoutCents: 0, keptCents: 200 });
  });

  it('keeps at least Stripe’s cost, when it is more than the fee', () => {
    // €5 rent, €300 deposit: fee €4.80, but Stripe took €4.90.
    const big: PaidAmounts = {
      rentCents: 500,
      depositCents: 30000,
      feeCents: 480,
      lenderFeeCents: 500,
    };
    expect(
      cancellationPlan(big, { by: 'RENTER', cancelledAt: before(48), start }),
    ).toEqual({ refundCents: 30490, lenderPayoutCents: 0, keptCents: 490 });
  });

  it('splits the rent when the renter cancels within 24 hours', () => {
    expect(
      cancellationPlan(paid, { by: 'RENTER', cancelledAt: before(3), start }),
    ).toEqual({ refundCents: 6000, lenderPayoutCents: 850, keptCents: 350 });
  });

  it('counts exactly 24 hours as within, a moment more as before', () => {
    expect(
      cancellationPlan(paid, { by: 'RENTER', cancelledAt: before(24), start })
        .lenderPayoutCents,
    ).toBe(850);
    expect(
      cancellationPlan(paid, {
        by: 'RENTER',
        cancelledAt: new Date(before(24).getTime() - 1),
        start,
      }).lenderPayoutCents,
    ).toBe(0);
  });

  it('rounds the renter’s half of an odd rent down, and never pays the lender below zero', () => {
    const odd = { ...paid, rentCents: 2001 };
    expect(
      cancellationPlan(odd, { by: 'RENTER', cancelledAt: before(1), start }),
    ).toMatchObject({ refundCents: 6000, lenderPayoutCents: 851 });
    const tiny = { ...paid, rentCents: 100, lenderFeeCents: 100 };
    expect(
      cancellationPlan(tiny, { by: 'RENTER', cancelledAt: before(1), start })
        .lenderPayoutCents,
    ).toBe(0);
  });

  it('always adds up to what was charged', () => {
    for (let rent = 0; rent <= 60_000; rent += 1_733) {
      for (let deposit = 0; deposit <= 90_000; deposit += 3_127) {
        if (rent + deposit === 0) continue;
        const fees = bookingFees(rent, deposit);
        const amounts: PaidAmounts = {
          rentCents: rent,
          depositCents: deposit,
          feeCents: fees.renterFeeCents,
          lenderFeeCents: fees.lenderFeeCents,
        };
        for (const hours of [48, 3]) {
          const plan = cancellationPlan(amounts, {
            by: 'RENTER',
            cancelledAt: before(hours),
            start,
          });
          expect(
            plan.refundCents + plan.lenderPayoutCents + plan.keptCents,
          ).toBe(chargeOf(amounts));
          expect(
            Math.min(plan.refundCents, plan.lenderPayoutCents, plan.keptCents),
          ).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('settlementPlan (ADR-0021)', () => {
  it('pays the lender the rent minus their deposit fee and returns the deposit', () => {
    expect(settlementPlan(paid)).toEqual({
      transferCents: 1850,
      depositRefundCents: 5000,
      keptCents: 350,
    });
  });
});
