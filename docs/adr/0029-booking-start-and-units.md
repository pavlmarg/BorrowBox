# ADR-0029: When a booking can start

**Status:** Accepted. Amends [ADR-0015](0015-booking-model.md) (a booking started at least 1 hour from now). Offers in chat ([ADR-0018](0018-price-offers.md)) keep their 1 hour.

## Context
ADR-0015 made a booking start at least one hour from now, on a whole hour. In practice that's up to two hours: at 13:10 the earliest start was 15:00. Neighbours often want something within the hour ("can I borrow your drill now?"), and testing the handoff meant waiting. The hour was meant to leave time to accept and pay, but a request already expires at its start if unanswered, and an accepted booking must be paid by its start (ADR-0019), so nothing breaks when that time is short.

## Decision
- **A booking starts on a whole hour still to come:** at 13:10 the earliest start is 14:00. Bookings refuses a start at or before now (`INVALID_PERIOD`); the PWA's period picker offers hours from the next whole one. The 180-day limit is unchanged.
- **Offers keep one hour** (`OFFER_MIN_LEAD_HOURS`): a lender's offer starts at least an hour ahead and closes an hour before its start, as ADR-0018 says, so the renter has time to book it and pay.
- Nothing else moves: a request still expires after 24 h or at its start, an accepted booking must be paid by its start (paying can't begin in its last 10 minutes), and the pickup opens 2 h before the start, so it's open at once.

## Consequences
- A booking can be requested, accepted, paid and picked up within the hour.
- Bookings starting soon leave little time to answer and pay, so more of them will expire; the booking page already shows the pay-by time and the request's expiry.
- `BOOKING_MIN_LEAD_HOURS` is gone from `libs/contracts`; `checkPeriod` takes an optional lead for offers.
