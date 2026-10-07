# ADR-0011: One location offset per place, per lender

**Status:** Accepted. Amends the offset rule of [ADR-0007](0007-location-privacy-search.md).

## Context
ADR-0007 draws one random offset (150–300 m, random direction) **per item**. A lender who lists several things from home therefore shows several public points, scattered on a ring around the house. Search results carry each item's lender, so anyone can group a lender's items and average their public points. The average lands close to the real home: with 10 items, typically within about 50 m. The more a lender lists, the less the fuzzing protects them, which is the opposite of what we want from our most active lenders.

## Decision
- **Items in one place share one offset.** When a pin is set, Catalog looks for the same lender's nearest other item whose exact point is within 300 m of the new pin. If there is one, the new pin reuses that item's offset, so all of the lender's items at one place show the same public point (or points exactly as far apart as the pins).
- **Otherwise, ADR-0007's rules apply unchanged:** a pin moved less than 300 m keeps the item's own offset; anything else draws a fresh one.
- **Order of the rules:** the nearest sibling within 300 m wins over the item's own offset, so a place never collects two different offsets through moves.
- **Serialised per lender.** Setting a location takes the lender's item lock (the one creates and account erasure already use), so two items placed at the same moment can't draw two different offsets for the same place.
- Items more than 300 m apart are different places and keep independent offsets, as before.

## Consequences
- Averaging a lender's items at one place reveals nothing beyond a single public point.
- A lender's items at home appear at the same point on the map; the map clusters them, which is how a shared location should look anyway.
- **Accepted for now (revisit in Phase 7):** a lender who moves an item's pin 300 m or more away and later back draws a new offset each time. Someone recording that item's public point over weeks could collect several offsets for the same home and average them. This needs repeated deliberate moves and long observation. The robust fix, deriving the offset from a server secret, the lender and a coarse area so that a place always gets the same offset, is more complex and is listed in ARCHITECTURE.md §10.
- The rule only looks at the lender's items that currently have a location; tombstones keep none, so deleted items don't pin an offset forever.
