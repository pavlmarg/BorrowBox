# ADR-0029: When a booking can start, and how long it can be

**Status:** Accepted. Amends [ADR-0015](0015-booking-model.md) (a booking started at least 1 hour from now and could last any whole number of hours) and [ADR-0010](0010-flexible-pricing.md)'s rental limits. Offers in chat ([ADR-0018](0018-price-offers.md)) keep their 1 hour. The rent is still worked out as ADR-0015 says.

## Context
- **Start:** ADR-0015 made a booking start at least one hour from now, on a whole hour. In practice that's up to two hours: at 13:10 the earliest start was 15:00. Neighbours often want something within the hour ("can I borrow your drill now?"), and testing the handoff meant waiting. The hour was meant to leave time to accept and pay, but a request already expires at its start if unanswered, and an accepted booking must be paid by its start (ADR-0019), so nothing breaks when that time is short.
- **Length:** any whole number of hours was allowed whatever the rates. An item rented only by the day could be booked for 26 hours and charged two days; renters found that confusing, and lenders who price by the day don't expect an afternoon booking.

## Decision
- **A booking starts on a whole hour still to come:** at 13:10 the earliest start is 14:00. Bookings refuses a start at or before now (`INVALID_PERIOD`); the PWA's period picker offers hours from the next whole one. The 180-day limit is unchanged.
- **Offers keep one hour** (`OFFER_MIN_LEAD_HOURS`): a lender's offer starts at least an hour ahead and closes an hour before its start, as ADR-0018 says, so the renter has time to book it and pay.
- **A booking lasts whole units of the item's smallest rate** (`bookingLengths` in `libs/contracts`): an hourly rate (or a free item) → any whole hours; otherwise whole days (24 h), weeks (7 days) or months (30 days), starting at any hour. The item's own shortest and longest booking are rounded to that unit (shortest up, longest down; 90 days at most).
- **Bookings** refuses other lengths (`INVALID_PERIOD`) for requests, quotes and offers. **Catalog** refuses limits that leave no length (`VALIDATION_FAILED`), when they're saved and when the rates change; an item saved before this with such limits simply can't be booked. The **PWA's** picker only offers ends that fit, says how the item is rented ("rented by the day: pick whole days") and shows the rounded limits.
- Nothing else moves: a request still expires after 24 h or at its start, an accepted booking must be paid by its start (paying can't begin in its last 10 minutes), the pickup opens 2 h before the start (so it's open at once), and the rent is still the cheapest combination of offered units, fixed at request. Bookings already made keep their periods.

## Consequences
- A booking can be requested, accepted, paid and picked up within the hour.
- Bookings starting soon leave little time to answer and pay, so more of them will expire; the booking page already shows the pay-by time and the request's expiry.
- A daily item's bookings always cost whole days, as shown; a lender who wants hours must add an hourly rate.
- `BOOKING_MIN_LEAD_HOURS` is gone from `libs/contracts`; `UNIT_HOURS` moved there from Bookings; `checkPeriod` takes the rate card and an optional lead for offers.
