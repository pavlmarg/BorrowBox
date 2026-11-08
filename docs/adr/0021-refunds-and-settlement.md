# ADR-0021: Refunds and settlement

**Status:** Accepted. Amends [ADR-0019](0019-payments-fees-and-policies.md)'s cancellation rules, which refunded the service fee on early cancellations, and settles what [ADR-0020](0020-booking-fees.md) left to it. Builds on [ADR-0003](0003-stripe-separate-charges-transfers.md).

## Context
A paid booking holds the renter's whole payment (rent, deposit and service fee) on the platform's Stripe account (ADR-0003). It leaves that account in one of two ways: back to the renter's card when the booking is cancelled, or split when it completes, the rent to the lender and the deposit back. Stripe keeps its processing fee on refunds, so ADR-0019's "everything refunded, the fee included" lost BorrowBox Stripe's cost on every early cancellation, against ADR-0020's rule that every charged booking earns at least what Stripe takes. Money movement is also where retries, late events and Stripe's own delays can do the most harm.

## Decision

### Where the money goes
- **The renter cancels more than 24 hours before the start:** everything back except the service fee, and never less than Stripe's cost is kept.
- **The renter cancels within 24 hours:** the deposit and half the rent back (rounded down to the cent); the lender gets the other half minus their deposit fee (ADR-0020), never below zero; BorrowBox keeps the rest.
- **Not the renter's doing** (the lender cancels, the item is deleted, the lender's account is erased): everything back. BorrowBox absorbs Stripe's cost for now.
- **The renter's account is erased:** as if the renter cancelled at that moment. `booking.cancelled.v1` carries the erased account's id (`erasedUserId`) so Payments can tell which side it was.
- **A payment that came through after the booking had closed** (or for a booking that never went ahead): everything back.
- **The booking completes:** the lender gets the rent minus their deposit fee, transferred from the renter's charge (`source_transaction`, `transfer_group = booking_<id>`), and the deposit goes back.
- **A transfer waits while the lender can't be paid** (their account restricted, or gone), retried with backoff and logged as an error after 7 days. **A disputed booking waits** for the dispute's outcome; nothing moves until then (the admin area decides damage claims later).

The rules are pure functions in `libs/contracts` (`cancellationPlan`, `settlementPlan`), so the PWA can show "you'd get back €X" before someone cancels.

Examples: €20 rent, €50 deposit, €2.00 fee, €1.50 lender fee; the renter paid €72.00 and Stripe kept about €1.33.

| Case | Renter gets back | Lender receives | BorrowBox keeps, after Stripe |
|---|---|---|---|
| Completed | €50.00 (the deposit) | €18.50 | +€2.17 |
| Renter cancels more than 24 h ahead | €70.00 | – | +€0.67 |
| Renter cancels within 24 h | €60.00 | €8.50 | +€2.17 |
| Lender cancels, item deleted, lender erased | €72.00 | – | −€1.33 |
| Paid after the booking closed | €72.00 | – | −€1.33 |

### How it moves
- **One row per refund or transfer** (`money_movements`), planned in the same transaction as the booking event that causes it, once per payment and purpose (a unique constraint), and carried out by the worker with the row's id as Stripe's idempotency key: a retry, a repeated event or a crash never moves money twice.
- **Never more than was charged:** a payment's planned refunds and transfers are added up on its row under a database CHECK.
- **Announced once:** `payment.refunded` (the renter's refund is on its way) or `payment.settled` goes out when all of a payment's movements went through. Refunds still pending at Stripe are followed by webhook; a failed one is logged for a person to check.
- **Orphaned Stripe accounts:** once a day, Payments lists the platform's connected accounts and, for those carrying our user id, saves an id it lost (a crash mid-onboarding) or deletes accounts nobody owns any more (a second account after an expired idempotency key, an erased lender's). Accounts without our id are never touched.

## Consequences
- Early cancellations by the renter no longer lose money; cancellations that aren't the renter's doing still lose Stripe's cost. Recovering it from the lender would need a running balance per lender: a side decision.
- Stripe Connect's payout and monthly account fees aren't in any per-booking amount (payouts are batched per lender): a side decision.
- Payment records are kept; how long (the Greek legal period) is a side decision until confirmed.
- Settlement runs on `booking.completed`, which Phase 5 (handoff and claim window) will emit; until then it is exercised by tests and the live Stripe run.
