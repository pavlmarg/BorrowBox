# ADR-0026: Handoff: QR scans, unscanned handoffs and the claim window

**Status:** Accepted. Fills in ARCHITECTURE §5 (QR handoff) and changes [ADR-0015](0015-booking-model.md)'s state machine: a booking going ahead (`PAID`, `CONFIRMED`) can now expire (`NO_HANDOFF`). Money follows [ADR-0021](0021-refunds-and-settlement.md) unchanged. Damage claims, condition photos and resolving disputes come later (PR B; the admin area in Phase 6).

## Context
Phase 4 left bookings at `PAID`/`CONFIRMED`: nothing recorded that the item changed hands, so `booking.completed` (which settles the money) was never emitted. ARCHITECTURE §5 sketched a QR handoff, but not what happens when people meet and forget to scan, when one of them says it didn't happen, or what a scan proves. A forgotten scan must not lose anyone money by default, and a refund must not happen while one person says the item changed hands.

## Decision
- **Token:** `v1.<base64url JSON { b, ph, n, exp }>.<base64url Ed25519 signature>`, signed with a key only Bookings holds (`HANDOFF_PRIVATE_KEY`, `tools/gen-handoff-key.mjs`). Valid 45 s; the showing screen fetches a new one every 30 s. Our own short format, not a JWT, so the QR code stays small; only Bookings reads it.
- **Who shows, who scans:** the lender shows at pickup, the renter at return; the other one scans (`NOT_COUNTERPARTY` otherwise). Bookings checks the signature, expiry, phase against the state, the scanner and the window, then spends the nonce (`SET NX` in Redis, kept 2 minutes) and moves the booking in one transaction. If the transaction fails after the nonce is spent, that code is lost and the next one (≤30 s) works.
- **Fallback code:** 6 digits from the token's signature (SHA-256, first 32 bits mod 10⁶), stored in Redis for the token's 45 s. At most 5 wrong codes per booking and phase in 10 minutes (`RATE_LIMITED`), plus 10 scans per user per minute at the gateway.
- **Redis down:** handoffs fail closed (`HANDOFF_UNAVAILABLE`, 503); the nonce check is never skipped.
- **Windows:** pickup from 2 h before the start while `PAID`/`CONFIRMED`; return any time after pickup (early or late; no late fees).
- **Nobody scanned:** both are asked "did it happen?" at +2 h, +24 h and +48 h after the start (pickup) or after the end, or the pickup if later (return). Each round asks only those who haven't answered, by email (`booking.handoff_unconfirmed.v1`) and on the booking page. Answers are given in the app (signed in), never through one-click links, and are final. At +72 h the outcome falls due.
  - Pickup: both yes → `PICKED_UP`; both no, or nobody claims it by the deadline → `EXPIRED` (`NO_HANDOFF`), a full refund (Payments already refunds everything when a paid booking closes for anything but the renter's own doing); yes against no at once, or one yes and the other silent at the deadline → admin review.
  - Return: the lender is the one who loses out, so their yes is enough (`RETURNED`); their no, or no answer from them by the deadline → admin review.
- **Admin review:** the booking keeps its status (money stays where it is, the period stays held) with `review_reason` set and `booking.review_requested.v1` (both emailed, a chat line). The timeline stops. A return scanned meanwhile proves the pickup too (`PICKED_UP` → `RETURNED` in one transaction) and clears it. Otherwise the admin area decides (Phase 6).
- **Claim window:** 48 h after the return, then `COMPLETED` (`booking.completed`, which settles). Without a deposit there's nothing to claim: the booking completes at the return.
- **Timers:** one `handoff_due_at` per booking (next round, outcome or end of the claim window) on the existing expiry queue, re-checked under the row lock; the 10-minute sweeper catches lost jobs. A late timer sends only the latest round due.
- **Erasure during a rental:** the gateway refuses `DELETE /me` with `409 ACTIVE_RENTALS` while the person has a booking `PICKED_UP`, `RETURNED` or `DISPUTED` (GDPR allows delaying erasure while a contract is performed). It's a check, not a lock: if a scan slips in, Bookings logs an error for a person.
- **Item deleted while rented out:** allowed; `item.deleted` still cancels only bookings not yet picked up, and one in someone's hands finishes normally from Bookings' own snapshot.
- **Records:** `handoffs` (method `QR`, `CODE`, `CONFIRMED`, `RETURN_SCAN`, later `ADMIN`; who showed and scanned) and `handoff_answers`, both in the export.

## Consequences
- Settlement now runs without a hand-published event.
- If two people meet but ignore all three emails, the renter is refunded and the lender loses the rent; the admin area can correct it afterwards.
- Bookings in review wait for Phase 6: fine in test mode, needed before launch.
- Anyone who photographs a code can forward it to a scanner elsewhere within 45 s; that only proves the two collude.
- The booking state machine grows two arrows (`PAID`/`CONFIRMED` → `EXPIRED`); a reason value (`NO_HANDOFF`) is added to `booking.expired.v1`, additive since every consumer reads the reason as a string or ignores it.
