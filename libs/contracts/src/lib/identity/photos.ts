/**
 * Profile photos (ADR-0024). Uploaded and processed like item photos
 * (ADR-0009, ADR-0013): same accepted types and size limit, but cropped to
 * a square. Public, like the display name: shown wherever the name is.
 */

/** Processed sizes (square WebP), by edge length in pixels. */
export const PROFILE_PHOTO_VARIANTS = { small: 96, large: 512 } as const;
export type ProfilePhotoUrls = Record<
  keyof typeof PROFILE_PHOTO_VARIANTS,
  string
>;

/** Photos whose shorter side is below this are rejected. */
export const PROFILE_PHOTO_MIN_PX = 128;

/**
 * A new photo that isn't shown yet: still being processed (`PENDING`), or
 * unusable (`FAILED`: unreadable, too small, wrong type). The current photo,
 * if any, stays until a new one is ready.
 */
export const PROFILE_PHOTO_UPLOAD_STATUSES = ['PENDING', 'FAILED'] as const;
export type ProfilePhotoUploadStatus =
  (typeof PROFILE_PHOTO_UPLOAD_STATUSES)[number];
