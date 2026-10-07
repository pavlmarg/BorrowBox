# @borrowbox/media

Photo storage and processing (ADR-0009, ADR-0013). Used by Catalog's photo
pipeline now, and by Bookings' condition photos in Phase 5.

## Storage

- `createStorageClient(settings)`: an S3 client for SeaweedFS (dev, tests) or
  Cloudflare R2 (production), with path-style URLs and checksums only when
  required (otherwise presigned browser uploads fail).
- `presignUpload(client, { bucket, key, contentType, expiresInSeconds })`: a
  presigned `PUT` with the Content-Type signed, so storage refuses any other
  type.
- `objectSize`, `readObject` (refuses objects over a size limit without
  reading them), `writeObject`, `deleteObjects` (missing objects count as
  deleted).

## Images

`processImage(buffer, rules)` treats the input as untrusted:

1. size limit, then the real type from the file's bytes (never SVG; HEIC
   can't be decoded), which must match the declared type;
2. pixel limit (decompression bombs) and minimum width after orientation;
3. for each requested width: apply the EXIF orientation, resize without
   enlarging, and encode WebP. **No metadata is written**: EXIF, GPS, XMP,
   IPTC and ICC are all dropped (tested on a GPS-tagged photo).

Failures throw `InvalidImageError` with a `reason`; its message never
contains input data.
