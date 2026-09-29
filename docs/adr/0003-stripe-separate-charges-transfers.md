# ADR-0003: Stripe Connect with separate charges & transfers and a refundable deposit

**Status:** Accepted

## Context
The platform must collect rent and a security deposit from the renter, pay the lender only after a successful return, and be able to keep part of the deposit when there's damage. Stripe offers no true escrow. Card authorization holds expire after about 7 days and aren't reliably extendable on EU cards.

## Decision
- Lenders onboard as **Express** connected accounts.
- The renter pays one PaymentIntent (`rent + deposit + service fee`) on the platform account, tagged with `transfer_group = booking_<id>`.
- On completion: `Transfer` (rent minus commission) to the lender and `Refund` the deposit.
- On a damage claim: transfer the approved amount from the deposit to the lender and refund the rest.

## Consequences
- Works for any rental length, and the platform controls when and how much money moves.
- The renter sees the deposit charged and then refunded, which needs clear UX copy. Refunds take 5–10 days to appear.
- The platform briefly holds funds, so check with Stripe or legal counsel that this flow is covered before a real EU launch.
- Stripe handles KYC, SCA and DAC7 data collection for lenders.
