import { bookingFees, stripeCostCents } from './fees';

describe('bookingFees (ADR-0020)', () => {
  it('charges nothing for a free booking without a deposit', () => {
    expect(bookingFees(0, 0)).toEqual({
      renterFeeCents: 0,
      lenderFeeCents: 0,
      chargeCents: 0,
      payoutCents: 0,
    });
  });

  it.each([
    // rent, deposit → renter fee, lender fee, renter pays, lender receives
    ['€20 rent, €50 deposit', 2000, 5000, 200, 150, 7200, 1850],
    ['€100 rent, no deposit', 10000, 0, 1000, 0, 11000, 10000],
    ['€3 rent, no deposit', 300, 0, 62, 0, 362, 300],
    ['a free item with a €30 deposit', 0, 3000, 146, 0, 3146, 0],
    [
      '€5 rent, €300 deposit (lender fee capped)',
      500,
      30000,
      480,
      500,
      30980,
      0,
    ],
  ])('%s', (_, rent, deposit, renterFee, lenderFee, charge, payout) => {
    expect(bookingFees(rent, deposit)).toEqual({
      renterFeeCents: renterFee,
      lenderFeeCents: lenderFee,
      chargeCents: charge,
      payoutCents: payout,
    });
  });

  it('takes 10% of the rent, rounded half up to the cent', () => {
    expect(bookingFees(1005, 0).renterFeeCents).toBe(101);
    expect(bookingFees(1004, 0).renterFeeCents).toBe(100);
  });

  it('charges the lender twice Stripe’s 1.5% on the deposit', () => {
    expect(bookingFees(10000, 5000).lenderFeeCents).toBe(150);
    expect(bookingFees(10000, 3333).lenderFeeCents).toBe(100); // 99.99 rounded up
  });

  it('keeps at least Stripe’s cost on every booking that charges anything', () => {
    for (let rent = 0; rent <= 200_000; rent += 1_337) {
      for (let deposit = 0; deposit <= 300_000; deposit += 2_917) {
        if (rent + deposit === 0) continue;
        const fees = bookingFees(rent, deposit);
        const stripe = stripeCostCents(fees.chargeCents);
        expect(
          fees.renterFeeCents + fees.lenderFeeCents,
        ).toBeGreaterThanOrEqual(2 * stripe);
        expect(fees.renterFeeCents).toBeGreaterThanOrEqual(50);
        expect(fees.lenderFeeCents).toBeLessThanOrEqual(rent);
        expect(fees.payoutCents).toBe(rent - fees.lenderFeeCents);
        expect(fees.chargeCents).toBe(rent + deposit + fees.renterFeeCents);
      }
    }
  });

  it('refuses amounts that are not whole cents', () => {
    expect(() => bookingFees(10.5, 0)).toThrow(RangeError);
    expect(() => bookingFees(-1, 0)).toThrow(RangeError);
  });
});
