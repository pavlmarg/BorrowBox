/**
 * What a booking costs on top of its rent and deposit (ADR-0020, replacing
 * ADR-0019's fee rule). Integer cents and basis points only: no floats for
 * money. Bookings fixes these amounts when a booking is requested, so what
 * the renter is shown is what they're charged.
 *
 * - The renter pays a service fee on top: 10% of the rent, at least €0.50,
 *   and never less than what keeps BorrowBox at or above Stripe's cost.
 * - The lender pays for their deposit: twice Stripe's percentage on it,
 *   taken from the rent BorrowBox transfers to them (PR C). It is capped at
 *   the rent; any rest is added to the renter's fee.
 * - So on every booking that charges anything, BorrowBox keeps at least as
 *   much as Stripe takes (with the standard EEA card rate below).
 */

/** Settings (change them here; existing bookings keep the amounts they were given). */
export const BOOKING_FEE_SETTINGS = {
  /** The renter's fee on the rent, in basis points (1000 = 10%). */
  renterRentBasisPoints: 1000,
  /** The smallest fee, and Stripe's smallest charge for EUR. */
  minimumChargeCents: 50,
  /** Stripe's standard EEA card rate: 1.5% … */
  stripeBasisPoints: 150,
  /** … plus €0.25 per charge. */
  stripeFixedCents: 25,
  /** BorrowBox keeps this many times Stripe's cost: 2 = as much as Stripe again. */
  costMultiple: 2,
} as const;

export interface BookingFees {
  /** On top of rent and deposit, paid by the renter. */
  renterFeeCents: number;
  /** Taken from the lender's rent for the deposit's cost (at most the rent). */
  lenderFeeCents: number;
  /** What the renter pays: rent + deposit + renter fee. */
  chargeCents: number;
  /** What the lender receives once the booking completes: rent − lender fee. */
  payoutCents: number;
}

const BASIS = 10_000;

/** ⌈a / b⌉ for integers, b > 0. */
function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

/** The fees for a booking of `rentCents` with `depositCents`; none when nothing is charged. */
export function bookingFees(
  rentCents: number,
  depositCents: number,
  settings: typeof BOOKING_FEE_SETTINGS = BOOKING_FEE_SETTINGS,
): BookingFees {
  assertCents(rentCents);
  assertCents(depositCents);
  if (rentCents + depositCents === 0) {
    return {
      renterFeeCents: 0,
      lenderFeeCents: 0,
      chargeCents: 0,
      payoutCents: 0,
    };
  }
  const {
    stripeBasisPoints: p,
    stripeFixedCents: fixed,
    costMultiple: k,
  } = settings;

  // The lender's part: k × Stripe's percentage of the deposit, capped at the rent.
  const depositCost = ceilDiv(depositCents * p * k, BASIS);
  const lenderFeeCents = Math.min(depositCost, rentCents);

  // 10% of the rent, rounded half up to the cent.
  const ofRent = Math.floor(
    (rentCents * settings.renterRentBasisPoints + BASIS / 2) / BASIS,
  );

  // The smallest renter fee f with f + lender fee ≥ k × Stripe's cost of the
  // charge, where the charge itself includes f:
  //   f + L ≥ k·(p·(R + D + f) + fixed)  ⇔  f ≥ (k·(p·(R + D) + fixed) − L) / (1 − k·p)
  const costFloor = Math.max(
    0,
    ceilDiv(
      k * (p * (rentCents + depositCents) + fixed * BASIS) -
        lenderFeeCents * BASIS,
      BASIS - k * p,
    ),
  );

  let renterFeeCents = Math.max(ofRent, settings.minimumChargeCents, costFloor);
  // Stripe's fee is a whole number of cents: make sure the guarantee holds
  // after rounding too (at most a cent or two more).
  while (
    renterFeeCents + lenderFeeCents <
    k * stripeCostCents(rentCents + depositCents + renterFeeCents, settings)
  ) {
    renterFeeCents++;
  }
  return {
    renterFeeCents,
    lenderFeeCents,
    chargeCents: rentCents + depositCents + renterFeeCents,
    payoutCents: rentCents - lenderFeeCents,
  };
}

/**
 * Stripe's fee for a charge at the settings' rate, rounded up to the cent
 * (Stripe rounds to the nearest cent, so this is never below it).
 */
export function stripeCostCents(
  chargeCents: number,
  settings: typeof BOOKING_FEE_SETTINGS = BOOKING_FEE_SETTINGS,
): number {
  assertCents(chargeCents);
  return (
    ceilDiv(chargeCents * settings.stripeBasisPoints, BASIS) +
    settings.stripeFixedCents
  );
}

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError('Amounts are whole, non-negative cents');
  }
}
