# ADR-0019: Payments: lender onboarding, fees, payment timeout and refunds

**Status:** Accepted; the service-fee rule is replaced by [ADR-0020](0020-booking-fees.md), the cancellation rules amended by [ADR-0021](0021-refunds-and-settlement.md). Builds on [ADR-0003](0003-stripe-separate-charges-transfers.md). Settles what [ADR-0010](0010-flexible-pricing.md) (Stripe's minimum charge), [ADR-0015](0015-booking-model.md) (payment timeout, cancelling a paid booking) and [ADR-0018](0018-price-offers.md) (the fee on an offer price) left to Phase 4.

## Context
ADR-0003 fixes the shape of the money flow: lenders are Stripe Express connected accounts; the renter pays one PaymentIntent (rent + deposit + service fee) on the platform account; on completion the platform transfers the rent to the lender and refunds the deposit. It leaves open what the platform charges, what happens when nobody pays or someone cancels, how lenders are set up, and how Stripe's webhooks reach the services. Phase 4 builds the backend first (onboarding, then checkout, then refunds and settlement), and the PWA's screens for Phases 3 and 4 follow together.

## Decision

### Lenders
- **Payouts must be set up before accepting a paid booking.** Bookings keeps which lenders can be paid from `payment.account_ready` / `payment.account_restricted` and refuses the accept with `PAYOUTS_NOT_SET_UP`. Publishing items isn't blocked, so items already published keep working, and free bookings never need Stripe.
- **The Stripe account is created when the lender first asks** ("Set up payouts"), not at sign-up: people who never lend never reach Stripe.
- **Nothing personal is sent to Stripe.** Only our user id (as metadata), the country (`GR` for launch, configurable) and the `transfers` capability under the recipient service agreement; Stripe asks the lender for everything else on its own pages.
- **A verified email is needed** to set up payouts, like publishing and booking. Payments keeps who is verified from `user.email_verified`.
- **Ready means Stripe's `transfers` capability is active**, the one capability separate charges and transfers need. Becoming ready emits `payment.account_ready.v1`; losing it later emits `payment.account_restricted.v1`. What the lender sees is one of `NOT_STARTED`, `INCOMPLETE`, `PENDING`, `READY`, `RESTRICTED`.
- **Stripe sends the lender back to `/settings/payouts`** (`?stripe=return`, or `?stripe=refresh` when the link expired).
- **Erasure:** `user.deletion_requested` closes the account (an erased account's still-valid tokens are refused), and a worker asks Stripe to delete the connected account, retrying until it succeeds. Payment records are kept (below).

### Webhooks
- **One public entry point:** Stripe calls the gateway (`POST /api/webhooks/stripe` for platform events, `/api/webhooks/stripe-connect` for connected accounts' events). The gateway passes the raw body and the `Stripe-Signature` header over TCP to Payments, which verifies them; the gateway holds no Stripe secret. The two endpoints have different signing secrets. They are not rate limited and not in the OpenAPI spec.
- **Stored by id, processed later:** Payments stores the event id, type and the object it's about (unique on the id, so resends are no-ops), never the payload, and answers at once. A worker processes events with retries and backoff. Processing **fetches the object's current state from Stripe**, so events arriving out of order or late can't roll anything back.

### Money (PRs B and C)
- **Service fee:** replaced by [ADR-0020](0020-booking-fees.md): the renter's fee also covers Stripe's cost, and the lender pays for their deposit. Stripe's €0.50 minimum is still always met.
- **Offers:** the fee is computed on the booking's stored rent, so on the offer price when there was one.
- **Paying:** after the lender accepts, the renter has until 24 hours after the acceptance or the booking's start, whichever is sooner. Then `ACCEPTED → EXPIRED` with reason `PAYMENT_TIMEOUT`. A failed payment leaves the booking `ACCEPTED`; the renter is emailed and can try again until then.
- **Checkout (PR B):** one card PaymentIntent per booking, created when the renter starts paying (bookings never paid never reach Stripe) and charged at once; cards only, because methods that settle over days would outlive the pay-by time. Paying can't start in the last 10 minutes. A booking that closes unpaid has its PaymentIntent cancelled; a payment that still succeeds for a closed booking is refunded in full.
- **Cancelling a paid booking** (amended by [ADR-0021](0021-refunds-and-settlement.md): an early cancellation by the renter keeps the service fee, at least Stripe's cost):
  - the renter, more than 24 hours before the start: everything is refunded, the fee included;
  - the renter, within 24 hours of the start: the deposit and half the rent are refunded, the lender is paid the other half, and the platform keeps the fee;
  - the lender, or the item is deleted: everything is refunded;
  - the renter's account is erased: as if the renter cancelled at that moment.
- **Settlement** on `booking.completed`: transfer the rent (minus the commission) to the lender, then refund the deposit. It is built and tested in Phase 4; it runs for real once Phase 5's handoff and claim window exist. Damage claims wait for the admin area.
- **Records:** payment, transfer and refund rows are kept for a legal retention period (configurable), without anything that isn't needed for it.

Examples (amounts in integer cents):

| Rent | Deposit | Fee | Renter pays |
|---|---|---|---|
| €20.00 | €50.00 | €2.00 | €72.00 |
| €3.00 | €0.00 | €0.50 (minimum) | €3.50 |
| €0.00 | €30.00 | €0.50 (minimum) | €30.50 |
| €0.00 | €0.00 | none | nothing (`CONFIRMED`, ADR-0015) |

## Consequences
- Bookings needs a read model of payable lenders (PR B), and the PWA must lead lenders to "Set up payouts" before they can accept a paid request.
- A free item with a deposit costs the renter €0.50 on top: the PWA must show the fee before requesting.
- Webhook processing costs one Stripe API call per event, in exchange for never trusting stale or reordered payloads and never storing Stripe's personal data.
- Locally both webhook routes share the signing secret `stripe listen` prints; in a deployment each endpoint has its own.
- How the fee is rounded: settled by [ADR-0020](0020-booking-fees.md).
- ⚠️ Before a real launch (as ADR-0003): confirm the flow of funds with Stripe or counsel, and the legal retention period for payment records in Greece.
