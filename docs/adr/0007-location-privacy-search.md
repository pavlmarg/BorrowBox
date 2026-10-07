# ADR-0007: Location privacy: fixed fuzz offset and search on the public point

**Status:** Accepted. Supersedes parts of [ADR-0004](0004-location-fuzzing.md): the offset rules and where search runs. The offset rule is amended by [ADR-0011](0011-one-offset-per-place.md): a lender's items in one place share one offset.

## Context
ADR-0004 stores a private exact point (`location`) and a public fuzzed point (`location_public`) per item. Two parts of it needed revisiting before Catalog is built:

- **Search on the exact point leaks it.** ADR-0004 let distance search run on the exact point and only rounded the displayed distance. Rounding doesn't help: anyone can repeat a search from a few positions while shrinking the radius, see when the item drops out of the results, and trilaterate the home to a few metres.
- **The docs disagreed on the offset.** ADR-0004 said a random 150–300 m offset. ARCHITECTURE.md said a "deterministic" ~300 m offset.
- **Moving the pin could leak it.** ADR-0004 didn't say what happens when a lender moves an item's pin. If every move drew a fresh random offset, several public points around nearly the same home would narrow it down (the true point lies where their 150–300 m rings overlap).

## Decision
- **Offset.** When an item first gets a location, Catalog draws one random offset: a direction uniform in [0°, 360°) and a distance uniform in [150 m, 300 m]. It computes `location_public` with PostGIS `ST_Project` and stores the offset (`offset_m`, `offset_bearing`) on the item. The offset is never re-randomised per request.
- **Moving the pin.** If the new exact point is less than 300 m from the old one, the stored offset vector is reused, so the public point moves exactly as far as the pin did. A move of 300 m or more is a new place, so a new offset is drawn.
- **Search runs only on `location_public`.** Queries use `ST_DWithin(location_public, :point, :radius)`, and sorting by distance uses the public point too. The exact point is never used in any query a non-owner can trigger.
- **Fixed radius steps.** The search radius must be one of 1, 2, 5, 10, 25 or 50 km. Map-viewport queries also filter on the public point.
- **Distance bands, not numbers.** Results show the distance from the searcher to the public point as a band: "< 1 km", "1–2 km", "2–5 km", "5–10 km", "> 10 km".
- **The searcher's position is not kept.** The coordinates a searcher sends are used for that query only. They are never stored or logged.
- **Unchanged from ADR-0004:**
  - the exact point stays private (only the owner sees it)
  - it is revealed only to a renter with a `PAID` booking, until the booking completes (Phase 3+)
  - the UI shows a circle, not a pin
  - every photo is stripped of EXIF/GPS data

## Consequences
- Every query result is a function of the public point only, so no amount of searching reveals more than the public point, which is already shown on the map. The true location stays somewhere in a 150–300 m ring around it.
- Results near the edge of a radius are off by up to 300 m: an item just inside the radius may be missing, or one just outside included. That's acceptable for neighbourhood borrowing.
- The fixed radius steps and distance bands make the search UI simpler, and leave no fine-grained numbers to probe.
- Catalog needs the offset columns and a unit-tested fuzz function (distance always within 150–300 m, a small move keeps the offset).
- The exact point is just a dropped pin, not a street address ([ADR-0008](0008-maps-pin-drop.md)). What a `PAID` renter receives in Phase 3 (the exact point, plus any pickup notes from the lender) is decided then.
