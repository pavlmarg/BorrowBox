# ADR-0009: Photo uploads through presigned URLs and a processing worker

**Status:** Accepted

## Context
Items need photos (later, Bookings also needs condition photos). Photos from phones carry EXIF metadata, often including GPS coordinates, which would leak a lender's home location (ADR-0004). The gateway accepts at most 100 kB request bodies and should not stream large files. Object storage is SeaweedFS locally and Cloudflare R2 in production; R2 supports presigned `PUT` uploads but not presigned `POST` policies, so a presigned upload can't enforce a maximum size.

## Decision
- **Upload directly to storage.** The client asks Catalog (through the gateway) to add a photo. Catalog creates a `PENDING` photo row and returns a presigned `PUT` URL (5-minute expiry, fixed content type) for a random key under a **private `incoming/` prefix**. The browser uploads straight to storage, then calls "confirm".
- **Process before serving.** "Confirm" enqueues a **BullMQ** job (Redis). The worker runs inside the Catalog process, with the shared code in a `libs/media` library:
  1. Re-check that the photo row still exists and is still `PENDING`, and skip it otherwise.
  2. Check the size (≤ 10 MB) and the real file type from the file's contents (JPEG, PNG or WebP).
  3. Apply the EXIF orientation, then strip **all** metadata.
  4. Write WebP versions 320, 800 and 1600 px wide under a **public `items/` prefix**.
  5. Delete the original from `incoming/` and mark the photo `READY` (or `FAILED`).
- **Only `READY` photos are ever returned or shown.** Nothing under `incoming/` is publicly readable.
- **Recovery and cleanup:**
  - A periodic sweeper re-enqueues photos left `PENDING` for too long (e.g. if the process stopped between the database commit and the enqueue).
  - A storage lifecycle rule deletes anything left in `incoming/` after 24 hours.
- **Deletion.** Deleting a photo, an item, or an account (`user.deletion_requested`) removes the stored files through a job, after the database change commits.
- **Limits** (defined in `libs/contracts`): 1–10 photos per item (larger items need shots from every side), each ≤ 10 MB, JPEG/PNG/WebP. iOS converts HEIC photos to JPEG when uploading from a browser, so HEIC isn't needed.

## Consequences
- The gateway stays small and stateless; large files never pass through it.
- No photo is visible before its metadata is stripped. Integration tests feed a JPEG with GPS EXIF through the worker and assert that the output has no metadata.
- An oversized or fake upload can sit in `incoming/` until the worker rejects it or the lifecycle rule removes it. It is never served.
- Catalog now depends on Redis (BullMQ) and object storage. Tests need an S3 container helper in `libs/testing`.
- The browser uploads to the storage origin, so the bucket needs a CORS rule for the PWA's origins.
- `libs/media` is reusable for Bookings' condition photos (Phase 5), which will be private and served through signed URLs instead of the public prefix.
