# ADR-0004: Fuzz public item locations

**Status:** Accepted

## Context
Items are listed from people's homes. Showing exact coordinates would expose home addresses to anyone, which is a safety risk and a GDPR concern.

## Decision
- Store the exact point (`location`) privately.
- Store a `location_public` point, offset once per item by a random distance of about 150–300 m, and use it for maps and distance display. Distance search still runs on the exact point, but results show only a rounded distance.
- Reveal the exact address only to a renter whose booking is `PAID`, and only until the booking completes.
- Strip EXIF metadata, including GPS, from every uploaded photo.

## Consequences
- Pins on the map are approximate, so the UI shows a circle rather than a pin.
- Because the offset is fixed rather than re-randomised per request, averaging repeated queries can't recover the real location.
