# ADR-0008: MapTiler tiles, and item locations set by dropping a pin

**Status:** Accepted

## Context
The PWA needs a map for Explore, the item page and the listing wizard. The docs disagreed: the README said OpenStreetMap tiles with Nominatim/Photon geocoding, while ARCHITECTURE.md mentioned MapTiler. A map involves two separate services:

- **Tiles** are the map imagery the browser downloads for the visible area. OpenStreetMap's own tile servers allow only light use and forbid relying on them for an app's production traffic.
- **Geocoding** turns a typed address into coordinates. If the browser sent a lender's home address to a public geocoder, we'd be sharing personal data with a third party. Nominatim's usage policy also forbids search-as-you-type, so we'd need a paid service anyway.

## Decision
- **Tiles: MapTiler**, rendered with MapLibre GL (OpenStreetMap data, EU-based provider, free tier).
  - The API key is public by design and restricted to our domains in MapTiler's dashboard.
  - The PWA reads the style URL and key from its build configuration, so changing provider (or self-hosting tiles) is a configuration change.
- **No geocoding.** In the listing wizard the lender sets the item's location by **dropping a pin on the map**, or by pressing "use my location" (the browser Geolocation API). No address is typed, so nothing is sent to a geocoder.
- **Searchers** choose their area the same way: "use my location", or panning the map. The default is central Athens.
- **Map display:** fuzzed points ([ADR-0007](0007-location-privacy-search.md)) are clustered when zoomed out and shown as circles when zoomed in, never as precise pins.
- **Bundle size:** MapLibre is large, so it's lazy-loaded on the pages that show a map.

## Consequences
- **Privacy:** only tile requests leave the browser. They reveal roughly which area someone is looking at (and their IP) to MapTiler, never an address. This must be listed in the privacy policy (a Phase 1 follow-up), and MapTiler needs a data processing agreement before launch.
- **Development:** a MapTiler account and key are needed from the first map screen onwards.
- **UX:** there's no "type your address" box. Searching by town or area name can be added later through the gateway, so the user's queries stay with us.
- **Exact data:** the exact location stored per item is a point, not a postal address.
