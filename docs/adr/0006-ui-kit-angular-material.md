# ADR-0006: Angular Material as the UI kit

**Status:** Accepted

## Context
The PWA needs a component library for forms, dialogs, navigation and lists. The docs listed Angular Material or PrimeNG. The first screens (auth, profile) are form-heavy, and later phases add a map, booking lists and a small admin area.

## Decision
Use **Angular Material** (with the CDK) as the UI kit for `apps/web`.

## Consequences
- It's first-party and released in step with Angular, so it keeps up with standalone components, Signals and zoneless change detection.
- Material 3 theming uses design tokens, which makes a light/dark theme cheap.
- It has fewer ready-made complex widgets than PrimeNG (no rich data table or calendar with ranges out of the box). Booking availability may need a custom date-range picker built on `MatDatepicker` or the CDK.
- The map (MapLibre GL) is independent of the UI kit.
