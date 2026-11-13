# ADR-0024: Profile photos

**Status:** Accepted. Builds on the photo pipeline of [ADR-0009](0009-photo-pipeline.md) and [ADR-0013](0013-wider-photo-formats.md).

## Context
Avatars were a silhouette and "Change photo" a placeholder (a Phase 1/2 follow-up). People are shown in several places (the top bar, their profile, an item's lender, chat, bookings), each served by a different service. A photo is personal data: it must be stripped of metadata like item photos, covered by the export and erased with the account.

## Decision
- **Identity owns profile photos**, as it owns the profile. It runs the same pipeline as Catalog: a presigned upload to the private bucket (`incoming/`), a BullMQ worker in the Identity process that strips all metadata and writes the processed sizes to the public bucket (`profiles/<random key>/`), a `photo_file_deletions` outbox for files and a 10-minute sweeper. Identity uses **its own storage key** (same rights as Catalog's: the two buckets only), never Catalog's.
- **Square, two sizes:** every photo is centre-cropped to a square on the server (whatever the browser sent) and stored as WebP at 96 and 512 px. The shorter side must be at least 128 px. Accepted types and the 10 MB limit are the item photos' (ADR-0013). The PWA crops to the centred square and re-encodes to JPEG (at most 1024 px) before uploading; there is no manual crop tool.
- **Public, like the display name:** shown wherever the name is, also to signed-out visitors (item pages). Served from the public bucket under random, never-reused keys.
- **One photo, swapped when ready:** a new upload waits in `user_photos` (`PENDING`, or `FAILED` when unusable) while the current photo stays. Once processed, it replaces the old one, whose files are listed for deletion in the same transaction. Unfinished or rejected uploads are dropped after a day.
- **Other services get it from the profile event:** `user.profile_updated.v1` gains an optional `photo` (`{ small, large }` URLs, or null), sent with every profile change, the photo's included, so "newest wins" still holds. Absent (older events, `user.registered`) means "keep what you have". This is additive, so no `v2`: the consumers' runtime checks ignore unknown fields. Catalog keeps it with lender names, Bookings with people's names (`BookingParty`, chat).
- **GDPR:** each service's export lists its copy. Erasure removes the photo and any waiting upload with their files in the deletion transaction, and blanks the photo in the kept outbox rows, like the name; Catalog and Bookings forget it on `user.deletion_requested`.

## Consequences
- Identity now needs Redis and object storage (`REDIS_URL`, `S3_*`, `PHOTOS_BASE_URL`) and a second storage key in every environment.
- The pipeline code is duplicated between Catalog and Identity. Worth extracting into `libs/media` (queue, worker, sweeper, deletion outbox) if a third service needs photos.
- No moderation yet: like item photos, an offensive photo stays until the admin area (reports, suspensions) exists.
- Other services' copies are URLs: if the public photo address changes (a new CDN domain), run `identity:republish-users` to refresh them.
- A replaced photo's URL may stay in browser and CDN caches until they expire (ARCHITECTURE.md §10, CDN caching).
