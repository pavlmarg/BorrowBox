# ADR-0023: "Further away" results beyond the search radius

**Status:** Accepted. Amends the fixed-radius rule of [ADR-0007](0007-location-privacy-search.md): a search may also list everything beyond its radius.

## Context
Explore searches within one of the fixed radii (1–50 km, ADR-0007). When nothing matches nearby, or the results run out, the borrower sees an empty list or the end of it, although the same thing may be on offer a little further away. Widening the radius by hand helps only up to 50 km, and repeats the results already seen.

## Decision
- A search can ask for what lies **beyond** its radius (`beyond: true`): items whose public point is farther than the radius, with **no upper limit**, nearest first, paged with the same cursor.
- Explore loads this "Further away" list once the results within the radius have run out (or there are none), from any search point (the device's location, "Search this area" or the default centre). It's shown below the results, in the list only.
- Every other filter (text, category, free only, maximum price) still applies.
- Everything else in ADR-0007 is unchanged: the search runs on `location_public` only, the radius itself is still one of the fixed steps, and distances are shown as bands (anything past 10 km is "over 10 km").

## Consequences
- Borrowers always see something to borrow when anything matches their filters, wherever it is.
- No new way to probe locations: the boundary is still one of the fixed radii on the public point, so "beyond 5 km" reveals exactly what "within 5 km" already did.
- "Beyond" can't use the GiST index for the radius (`NOT ST_DWithin`), so it measures every active item. Fine at today's scale; with many items, switch to a KNN order (`<->`) or cap the distance.
- Far-away items all show the "over 10 km" band; more bands would need a new `DistanceBand` value.
