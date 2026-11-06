# ADR-0018: Price offers in chat

**Status:** Accepted. Amends [ADR-0010](0010-flexible-pricing.md) (a booking may cost less than its rate card) and [ADR-0015](0015-booking-model.md) (a booking can start from an offer).

## Context
With chat open before any booking ([ADR-0017](0017-in-app-chat.md)), people negotiate: "would you do €20 for the weekend?". Until now a booking always cost the rate-card price, so an agreed discount had to go through the lender editing the item's rates, which changes it for everyone. A booking made at an agreed price must also be reproducible for disputes and, from Phase 4, for what Payments charges.

## Decision
- **The lender sends an offer** in a conversation: a period and a rent. The renter asks in text; there are no counter-offers.
- **Only the rent is negotiable.** The deposit stays the item's: it protects the lender and must be predictable for damage claims.
- **Bounds:** from €0 up to the rate-card rent for that period. Offers are discounts only, so the listed price stays honest and no one is asked to pay more in chat.
- **Rules of the period** are the booking's: whole hours, starting 1 hour to 180 days ahead, at most 90 days, within the item's own limits. The item must be `ACTIVE` when the offer is sent.
- **Lifetime:** an offer is valid for 48 hours, or until 1 hour before its start if sooner. A conversation has one open offer: a new one replaces it. The lender can withdraw it. It can be used once.
- **Using it:** the renter books at the offer, and the lender has already agreed. In one transaction the booking is created as `REQUESTED` with the offer's price and moved to `ACCEPTED` (or `CONFIRMED` if rent and deposit are 0), declining the item's overlapping requests like any accept. Both events are emitted, so the state machine doesn't change. The open-request limit doesn't apply. The slot must still be free; the item may have been paused since, but not deleted.
- **Contracts:** `BookingView.price` and the `booking.*.v1` payloads gain an optional `offerId` (additive). New events `offer.sent.v1` and `offer.withdrawn.v1` carry ids, the period and amounts, no text.
- **Notifications:** a new offer emails the renter.

## Consequences
- The booking stores the offer's price like any price snapshot; later changes to the item or the offer don't touch it.
- Payments (Phase 4) charges the stored price; whether the platform fee is computed on the offer price is decided there.
- Offers only go down, which leaves "extras" (delivery, accessories) to the rate card or to future features.
- A renter's own overlapping request for the item is declined (`OVERLAP`) when they book an offer, like anyone else's.
