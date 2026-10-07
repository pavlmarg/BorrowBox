# ADR-0013: Wider photo formats, converted in the browser first

**Status:** Accepted. Amends the format limit of [ADR-0009](0009-photo-pipeline.md).

## Context
ADR-0009 accepts JPEG, PNG and WebP only, assuming iOS browsers convert HEIC to JPEG. Lenders should be able to upload whatever photo their phone takes or holds, and take a photo with the camera right in the listing wizard. Two limits shape what is possible:

- Our image library (`sharp`, prebuilt) reads JPEG, PNG, WebP, AVIF, GIF and TIFF, but **not HEIC** (iPhone photos): its HEVC decoder isn't shipped, for patent reasons.
- **SVG must never be accepted:** it is a document that can carry scripts and external references, not a photo.

Full-size phone photos are also large (often 3–8 MB), which is slow on mobile data.

## Decision
- **The server accepts** JPEG, PNG, WebP, AVIF, GIF and TIFF (`PHOTO_CONTENT_TYPES` in `libs/contracts`, mirrored by a database CHECK). For GIF and multi-page TIFF only the first frame or page is used. The real type is read from the file's contents; the declared one must match. Output is always metadata-free WebP, as in ADR-0009.
- **The PWA converts before uploading (step 12).** Every photo the browser can display, including HEIC in Safari, is re-encoded in the browser to JPEG, at most 2048 px on its longer side, before the presigned upload. Files the browser can't display are uploaded as they are and must be one of the accepted types.
- **Camera (step 12):** on phones the wizard offers "Take photo" (opens the rear camera, `capture="environment"`) and "Choose photos" (gallery, several at once). Desktop shows only "Choose photos".
- Everything else in ADR-0009 is unchanged: 10 MB per upload, 1–10 photos per item, server-side metadata stripping is the guarantee (the browser's conversion is a convenience, never trusted for privacy).

## Consequences
- In practice any photo a phone takes or stores can be uploaded, including iPhone HEIC.
- Uploads from phones are smaller and faster; the 10 MB limit is rarely reached.
- The browser's conversion already drops most metadata, but the server still strips everything, so a modified client gains nothing.
- AVIF and TIFF decoding adds some CPU per photo in the worker; it runs at most two jobs at a time.
- HEIC uploaded without conversion (e.g. by a non-PWA client) is rejected as an unsupported type.
