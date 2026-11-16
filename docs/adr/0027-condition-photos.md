# ADR-0027: Condition photos

**Status:** Accepted. Fills in ARCHITECTURE §5 step 5 on top of [ADR-0026](0026-handoff.md) (handoff). Reuses the photo pipeline of [ADR-0009](0009-photo-pipeline.md) and [ADR-0013](0013-wider-photo-formats.md), but in a private bucket. Damage claims, which use these photos as evidence, come with the next ADR.

## Context
A damage claim needs evidence of the item's condition when it changed hands. Item and profile photos are public (`borrowbox-public`); condition photos are not: they can show someone's home, face or belongings, and only the two people (and later an admin) have any business seeing them. They must also not stay forever.

## Decision
- **Who and when:** each of the two people may add up to 3 photos per handoff. Pickup photos from when the pickup opens (2 h before the start) until 2 h after the pickup was recorded; return photos while the item is out, until 2 h after the return, and while a damage claim is open. Optional: a failed upload must never block a handoff.
- **Pipeline:** the browser uploads to the existing private uploads bucket (`incoming/`, presigned PUT, same types and 10 MB limit); a Bookings BullMQ worker processes it with `sharp` (all metadata stripped, re-encoded) into two WebP sizes (320 px thumb, ≤1600 px) in a **new private bucket** `borrowbox-evidence` (`conditions/<random key>/`). Photos narrower than 320 px or unreadable end `FAILED` and don't count towards the limit. File deletions go through a `photo_file_deletions` outbox, like Catalog's and Identity's; a 10-minute sweeper re-queues interrupted processing and drops day-old abandoned uploads.
- **Storage access:** a `bookings` storage identity with read/write on the uploads and evidence buckets only, never the public one; Catalog's and Identity's keys can't read evidence; the evidence bucket has no public access and no CORS.
- **Viewing:** only the lender and renter, through `GET /bookings/:id/photos`: presigned GET links valid 5 minutes, signed fresh on every request. Never in the booking view, events or logs. The confirm time (server clock) is the photo's time; EXIF dates are stripped with the rest.
- **Removing:** the uploader may remove their own photo while that handoff's window is open; afterwards it's evidence and stays.
- **Retention:** deleted 30 days after the booking finished (completed, expired, cancelled, declined); a booking under dispute isn't finished, so its photos stay until 30 days after it completes. Account erasure deletes the person's own photos (erasure is refused while an item is out or disputed, ADR-0026, so no open claim loses evidence). The export lists the caller's own photos with 5-minute links.

## Consequences
- One more bucket and storage key to set up in every environment (dev: two new lines in `infra/.env`; production: R2, `infra/storage/README.md`).
- The photo pipeline is now copied three times (Catalog, Identity, Bookings). Moving the shared worker pieces into `libs/media` is worth a refactor of its own.
- Links can be shared for their 5 minutes; that's accepted, as with any image a person can screenshot.
- Phase 6's admin will need its own way to view a booking's photos.
