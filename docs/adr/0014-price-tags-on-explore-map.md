# ADR-0014: Price tags on Explore's map, with the area on hover

**Status:** Accepted. Amends the map display rule of [ADR-0004](0004-location-fuzzing.md), [ADR-0007](0007-location-privacy-search.md) and [ADR-0008](0008-maps-pin-drop.md) for Explore's map only.

## Context
Explore's map drew every item as a filled circle of the largest offset's radius (300 m) around its public point, so the exact point is always inside it and nobody reads it as an address. At street level, nearby items' circles overlap into one blue blob: you can't tell how many items there are or point at one of them, and the hover card has no clear target.

A circle is centred on the public point, so the circle and a marker at its centre reveal exactly the same thing. The rule "a circle, never a pin" was never about hiding the public point; it was about not *suggesting* precision, so that nobody walks up to the wrong door. Teardrop pins were considered and rejected for that reason: they are the universal sign for "exactly here".

## Decision
- **Explore's map shows each item as a price tag** at its public point: a small rounded blue label with the item's main price ("€8", "Free") and a short pointer, turning orange when pointed at, or when its row in the list is pointed at. Clusters stay as they are when zoomed out.
- **The approximate area appears with the attention:** while an item is pointed at (on the map or in the list), its 300 m circle (`LOCATION_OFFSET_MAX_M`) is drawn around its public point in the same orange, together with the hover card. So the moment someone looks at an item's location, the map says "roughly here".
- **Clicking a tag opens the item's page.**
- **Never a teardrop pin**, and the area circle is always one hover away.
- **Everything else is unchanged:** the item page still shows only the area circle; the listing wizard still shows the owner's pin and the area others see; only public points ever reach the browser ([ADR-0007](0007-location-privacy-search.md)).

## Consequences
- Nearby items stay distinct and countable at street level, the price is readable at a glance, and the hover card points at one clear target.
- No new data is exposed: the tag marks the centre the circle already had.
- Tags are HTML markers, not map layers (the map style isn't guaranteed to supply fonts for text): MapView adds one per item that isn't in a cluster bubble, after every move.
- A lender's items at one place share one public point ([ADR-0011](0011-one-offset-per-place.md)), so their tags would stack. Bubbles therefore last up to zoom 17, which is also as far as Explore's map zooms in: items that never separate stay one numbered bubble, and clicking it shows their cards instead of zooming.
- Touch screens have no hover, so phones see the area circle only for an item highlighted from the list, and always on the item page.
- A marker looks more precise than a circle at a glance. The area on hover, the item page's circle and the distance bands ("1–2 km") keep reminding people it's approximate; revisit if users mistake tags for addresses.
