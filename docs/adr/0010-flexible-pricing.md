# ADR-0010: Flexible item pricing: hourly to monthly rates, or free

**Status:** Accepted

## Context
The first plan gave each item a single daily price of at least €1. Lenders need more freedom:
- small items are worth only a few cents to lend
- some people want to lend for free
- some items are borrowed for a few hours (a drill for an afternoon), others for weeks or a month (a baby cot, a camping set)

Catalog only *stores* prices. What a booking costs is computed by Bookings (Phase 3), and money moves through Payments (Phase 4, [ADR-0003](0003-stripe-separate-charges-transfers.md)). So this choice affects later phases too.

## Decision
- **A rate card per item.** The lender offers any subset of four rates, or marks the item as free:
  - `hourlyCents`, `dailyCents`, `weeklyCents`, `monthlyCents`: each optional; a missing rate means that unit isn't offered.
  - `free: true` means no rates at all.
- **Limits** (in `libs/contracts`):
  - Each offered rate is 10–100,000 cents (€0.10–€1,000).
  - A non-free item offers at least one rate.
  - The deposit stays separate (€0–€5,000), so a free item may still ask for a deposit.
- **Events and views** carry the whole rate card as `pricing` (no single "price" field).
- **Search filters:** "free only", and a maximum rate for a chosen unit (e.g. "≤ €5 / day"), which matches items offering that unit.
- **Display:** the PWA shows the smallest offered unit as a starting price ("from €0.50/hour"), or "Free".
- **Booking prices (Phase 3):** Bookings picks the cheapest combination of the offered rates for the requested period. For example, 9 days becomes 1 week + 2 days if that's cheaper than 9 daily rates. Minimum and maximum rental lengths are added then, as optional item fields, which isn't a breaking change for event consumers.

## Consequences
These must be decided in the phase named, and are recorded here so they aren't forgotten:
- **Phase 3: bookings with nothing to pay.** A free item with no deposit has nothing to charge, so its booking can't reach `PAID` through `payment.captured`. The state machine (ARCHITECTURE.md §4) needs a path for zero-total bookings, e.g. `ACCEPTED → PAID` directly or a separate `CONFIRMED` state.
- **Phase 4: Stripe's minimum charge.** Stripe can't charge less than €0.50, but a 2-hour rental at €0.10/hour totals €0.20 plus the service fee. Options include:
  - a minimum service fee
  - a minimum booking total
  - treating bookings under €0.50 like free ones and letting the lender collect cash in person
- **Phase 5: short rentals and the claim window.** The 48-hour claim window after a return may be too long for an hours-long rental. It could scale with the rental's length.
- Searching and sorting by price is less simple than with one daily price, because items offer different units. The per-unit filter keeps it predictable.
