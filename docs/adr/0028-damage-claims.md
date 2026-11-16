# ADR-0028: Damage claims and disputes

**Status:** Accepted. Amends [ADR-0021](0021-refunds-and-settlement.md) (settlement) and ARCHITECTURE §3/§6: the money of a dispute follows `booking.completed` with an award, not `dispute.resolved`. Builds on [ADR-0026](0026-handoff.md) (claim window) and [ADR-0027](0027-condition-photos.md) (evidence). Deciding contested claims through a screen is Phase 6's admin area.

## Context
After the return, the lender has 48 hours to report damage (ADR-0026). Until now `RETURNED → DISPUTED` existed only in the state machine, and Payments held a disputed booking's money forever: nothing could resolve it. ADR-0003 says a damage claim moves the approved part of the deposit to the lender and refunds the rest; how much, who decides, and how the decision reaches Payments were open. Money must stay in integer cents, move only in response to events, and never exceed the charge.

## Decision
- **Filing:** only the lender, only while `RETURNED` and the claim window is open. One claim per booking (`CLAIM_EXISTS`), not editable: an amount from €1 to the deposit, a description of 10–1000 characters without contact details (the chat's detector), and optionally up to 6 of the booking's ready condition photos. The booking moves to `DISPUTED` (`booking.disputed`, now with `claimCents`); the claim-window timer stops.
- **Answering:** the renter agrees (final: resolved with the claimed amount) or disagrees (waits for an admin), with an optional reply of ≤500 characters, same text rules. Silence decides nothing; the claim stays open for an admin.
- **Withdrawing:** the lender may withdraw while it's open or disagreed: resolved with no award.
- **Resolving, one path for every outcome:** in one transaction the claim records the award, `dispute.resolved.v1` (claim, award, `RENTER_AGREED` / `LENDER_WITHDREW` / `ADMIN`) is written for emails and later reviews, and the booking moves `DISPUTED → COMPLETED` with **`damageAwardCents` on `booking.completed.v1`** (an optional field: additive, no `v2`). The admin's award is 0 to the claimed amount.
- **Money (Payments):** settles from `booking.completed` alone, so nothing can arrive out of order: the lender's transfer = rent − their deposit fee + award (still one `RENT` transfer, from the renter's charge via `source_transaction`); the renter's refund = deposit − award (none at 0). What BorrowBox keeps doesn't change. `settlementPlan` throws on an award outside 0…deposit, and the database check (movements ≤ charge) still holds. Example, €20 rent and €50 deposit (€72 charged): award €30 → lender €48.50, renter €20.00, BorrowBox €3.50.
- **Until the admin area:** `nx run bookings:resolve-dispute -- --booking <id> --award-cents <n>` decides a dispute through the same path; refused when `NODE_ENV=production`.
- **Emails:** claim filed (renter), disagreed (lender), agreed (lender), withdrawn (renter), decided (both); the settlement emails give the final amounts.
- **GDPR:** the export lists claims on the person's bookings with only their own text. Erasure is refused while disputed (ADR-0026); afterwards it blanks the person's description or reply and keeps amounts and outcomes as financial records.

## Consequences
- A disagreed claim holds the deposit until an admin decides: acceptable in test mode, a launch blocker until Phase 6.
- A lender who files in bad faith delays the renter's deposit by up to the admin's response time; the claim is capped at the deposit and needs a description, and photos make it checkable.
- `dispute.resolved` is information only: a consumer must never move money on it.
