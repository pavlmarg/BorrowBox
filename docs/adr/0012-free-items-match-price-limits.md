# ADR-0012: Free items match a maximum-price search filter

**Status:** Accepted. Amends the search-filter rule of [ADR-0010](0010-flexible-pricing.md).

## Context
ADR-0010 says a search for a maximum rate for a chosen unit (e.g. "≤ €5 / day") matches items **offering that unit**. A free item offers no rates at all, so it would never match a price limit. A borrower asking "what can I get for at most €5 a day?" would then miss every free drill nearby, which is the cheapest answer to their question.

## Decision
- A maximum-price filter matches items that offer the chosen unit at or below the limit, **and all free items**.
- The separate "free only" filter is unchanged.
- Everything else in ADR-0010 is unchanged.

## Consequences
- Price-limited searches never hide something cheaper than the limit.
- A borrower who specifically wants priced items (e.g. to compare rates) gets free items mixed in; the result cards show "Free" clearly, so this is easy to scan.
- Implemented in Catalog's search as `($max IS NULL OR free OR <rate for unit> <= $max)`.
