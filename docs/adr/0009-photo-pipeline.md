# ADR-0009: Photo uploads through presigned URLs and a processing worker

**Status:** Accepted (amended in Phase 2, step 4: two buckets instead of public/private prefixes, scoped credentials, presigned-URL settings). The format limit is amended by [ADR-0013](0013-wider-photo-formats.md): JPEG, PNG, WebP, AVIF, GIF and TIFF, with the PWA converting photos to JPEG before upload.

## Context
Items need photos (later, Bookings also needs condition photos). Photos from phones carry EXIF metadata, often including GPS coordinates, which would leak a lender's home location (ADR-0004). The gateway accepts at most 100 kB request bodies and should not stream large files. Object storage is SeaweedFS locally and Cloudflare R2 in production; R2 supports presigned `PUT` uploads but not presigned `POST` policies, so a presigned upload can't enforce a maximum size.

Neither SeaweedFS nor R2 can make just one folder (prefix) of a bucket public; public read access is per bucket. This was verified against SeaweedFS 4.48.

## Decision
- **Two buckets:**
  - `borrowbox-uploads` is **private**: raw uploads under `incoming/` now, and Bookings' condition photos later. It has no public setting at all.
  - `borrowbox-public` is **public-read** (no listing, no anonymous writes) and holds only processed, metadata-free photos.
  - A raw photo with GPS data therefore can't become public through a misconfigured folder rule.
- **Credentials:**
  - An admin key is used only to create the buckets and their rules ([infra/storage/init.sh](../../infra/storage/init.sh)).
  - Catalog gets a key limited to reading and writing the two buckets; it can't create or delete buckets. In production these are scoped R2 API tokens.
- **Upload directly to storage.** The client asks Catalog (through the gateway) to add a photo. Catalog creates a `PENDING` photo row and returns a presigned `PUT` URL (5-minute expiry) for a random key under `incoming/` in the uploads bucket. The browser uploads straight to storage, then calls "confirm".
  - The URL **signs the `Content-Type`** (`signableHeaders: ['content-type']`), so storage rejects any other type.
  - The S3 client uses `requestChecksumCalculation: 'WHEN_REQUIRED'`. Otherwise the AWS SDK signs a checksum of an empty body into the URL and every real upload fails.
  - The uploads bucket's CORS rule allows `PUT` only from the PWA's origins.
- **Process before serving.** "Confirm" enqueues a **BullMQ** job (Redis). The worker runs inside the Catalog process, with the shared code in a `libs/media` library:
  1. Re-check that the photo row still exists and is still `PENDING`, and skip it otherwise.
  2. Check the size (≤ 10 MB) and the real file type from the file's contents (JPEG, PNG or WebP).
  3. Apply the EXIF orientation, then strip **all** metadata.
  4. Write WebP versions 320, 800 and 1600 px wide to the public bucket, under random keys that are never reused.
  5. Delete the original from the uploads bucket and mark the photo `READY` (or `FAILED`).
- **Only `READY` photos are ever returned or shown.** Browsers load them straight from the public bucket: `localhost:8333/borrowbox-public/…` in dev, an R2 custom domain in production.
- **Recovery and cleanup:**
  - A periodic sweeper re-enqueues photos left `PENDING` for too long (e.g. if the process stopped between the database commit and the enqueue).
  - The sweeper deletes `PENDING` photos older than 24 hours, both the row and the stored file. Every upload has a row, because the row is created before the URL is issued.
  - As a safety net, a storage lifecycle rule expires anything in `incoming/` after a day.
- **Deletion.** Deleting a photo, an item, or an account (`user.deletion_requested`) removes the stored files through a job, after the database change commits.
- **Limits** (defined in `libs/contracts`): 1–10 photos per item (larger items need shots from every side), each ≤ 10 MB, JPEG/PNG/WebP. iOS converts HEIC photos to JPEG when uploading from a browser, so HEIC isn't needed.

## Consequences
- The gateway stays small and stateless; large files never pass through it.
- No photo is visible before its metadata is stripped. Integration tests feed a JPEG with GPS EXIF through the worker and assert that the output has no metadata.
- An oversized or fake upload can sit in `incoming/` until the worker rejects it, the sweeper removes it, or the lifecycle rule expires it. It is never served.
- Catalog now depends on Redis (BullMQ) and object storage. Tests use `startS3()` from `libs/testing`, which runs the same SeaweedFS entrypoint and init script as `docker compose`.
- Public photos are public by design: anyone with a URL can view them. Keys are random and the bucket can't be listed. Lenders should be reminded not to show faces or identifying details (listing wizard).
- If a CDN caches public photos in production, a deleted photo can stay reachable at its old URL until the cache expires. The cache lifetime or purge-on-delete is decided at deployment (ARCHITECTURE.md §10).
- `libs/media` is reusable for Bookings' condition photos (Phase 5). Those stay in the private bucket and are served through short-lived signed URLs.
