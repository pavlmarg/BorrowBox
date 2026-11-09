# ADR-0020: Booking fees that always cover Stripe's cost

**Status:** Accepted. Replaces the service-fee rule of [ADR-0019](0019-payments-fees-and-policies.md) ("10% of the rent, at least €0.50") and settles its open question on rounding. The rest of ADR-0019 stands.

## Context
ADR-0019 charged the renter 10% of the rent, at least €0.50, and the lender nothing. Stripe takes its fee on the whole charge, deposit included, and keeps it when the deposit is refunded. So a booking with a large deposit and a small or zero rent cost BorrowBox more than it earned: a free item with a €30 deposit brought in €0.50 and cost about €0.70. BorrowBox has to earn something on every booking that charges anything, and the deposit protects the lender, so its cost belongs with them.

## Decision
- **The renter pays a service fee on top** of rent and deposit, the largest of:
  - 10% of the rent, rounded half up to the cent;
  - €0.50 (also Stripe's smallest charge);
  - what keeps BorrowBox's income on the booking at least twice Stripe's cost, so BorrowBox earns at least as much as Stripe takes.
- **The lender pays for their deposit:** twice Stripe's percentage on it (3% at the standard rate), rounded up to the cent, taken from the rent BorrowBox transfers to them (PR C). It is capped at the rent: whatever is left is added to the renter's fee, so a lender never pays out of pocket (a free item with a deposit costs its lender nothing).
- **Stripe's cost** is computed with the standard EEA card rate, 1.5% + €0.25, rounded up to the cent.
- **Settings:** the rates, the minimum and the multiple are constants in `libs/contracts` (`BOOKING_FEE_SETTINGS`). There's no runtime configuration: the PWA, Bookings and Payments must compute the same amounts.
- **Fixed at request time:** Bookings computes the fees with `bookingFees(rent, deposit)` when a booking is requested, like the rent, stores them on the booking and carries them in `booking.*` events. What the renter is shown is what they pay, even if the settings change later. A booking made from an offer pays the fee on the offer's price.
- A booking with nothing to pay (no rent, no deposit) has no fee and is never charged.

Examples (amounts in euros; Stripe's cost at 1.5% + €0.25, rounded up):

| Rent | Deposit | Renter's fee | Renter pays | Lender's fee | Lender receives | Stripe takes | BorrowBox keeps |
|---|---|---|---|---|---|---|---|
| 20.00 | 50.00 | 2.00 (10%) | 72.00 | 1.50 | 18.50 | 1.33 | 2.17 |
| 100.00 | 0 | 10.00 (10%) | 110.00 | 0 | 100.00 | 1.90 | 8.10 |
| 3.00 | 0 | 0.62 (cost) | 3.62 | 0 | 3.00 | 0.31 | 0.31 |
| 0 | 30.00 | 1.46 (cost) | 31.46 | 0 (capped) | 0 | 0.73 | 0.73 |
| 5.00 | 300.00 | 4.80 (cost) | 309.80 | 5.00 (capped) | 0 | 4.90 | 4.90 |

## Consequences
- Every charged booking earns BorrowBox at least what Stripe takes for the standard EEA card. A property test checks it over thousands of rent and deposit combinations.
- Lenders who ask for a deposit receive a little less than their rent, and a large deposit on a cheap item can take the whole rent: the PWA must show lenders the deposit's cost when they set it, and renters the fee before they request.
- Cards from outside the EEA cost Stripe more, so those bookings can earn less, or lose a little. If they become common, raise `stripeBasisPoints`.
- Not covered by any per-booking fee: chargebacks (Stripe's dispute fee) and Stripe Connect's account and payout fees. The payout fee should join the floor with settlement (PR C).
- Refunds (PR C) must keep at least Stripe's cost, which Stripe never returns: ADR-0019's "everything refunded, the fee included" would lose it. To be decided with PR C.
