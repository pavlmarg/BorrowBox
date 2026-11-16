import type { PhotoContentType } from '../catalog/validation';
import type { HandoffPhase } from './handoff';

/**
 * Condition photos (ADR-0027): at pickup and return, each of the two people
 * may add a few photos of the item. Uploaded and processed like other
 * photos (ADR-0009, ADR-0013: same types and size limit, metadata stripped),
 * but kept private: only the two people see them, through short-lived
 * links. The server's time is what counts as evidence.
 */

/** Photos per person and handoff (pending and ready ones count). */
export const CONDITION_PHOTOS_MAX_PER_PHASE = 3;

/** Processed sizes (WebP, proportions kept), by width in pixels. */
export const CONDITION_PHOTO_VARIANTS = { thumb: 320, large: 1600 } as const;
export type ConditionPhotoUrls = Record<
  keyof typeof CONDITION_PHOTO_VARIANTS,
  string
>;

/** Photos can still be added (or removed) this long after the handoff. */
export const CONDITION_PHOTO_WINDOW_AFTER_HOURS = 2;
/** Kept this long after the booking finished, then deleted. */
export const CONDITION_PHOTO_RETENTION_DAYS = 30;
/** Links to a photo work this long. */
export const CONDITION_PHOTO_URL_TTL_SECONDS = 5 * 60;

/** Being processed, ready to see, or unusable (unreadable, too small, wrong type). */
export const CONDITION_PHOTO_STATUSES = ['PENDING', 'READY', 'FAILED'] as const;
export type ConditionPhotoStatus = (typeof CONDITION_PHOTO_STATUSES)[number];

export interface ConditionPhotoView {
  id: string;
  phase: HandoffPhase;
  /** Who took it. */
  takenBy: 'RENTER' | 'LENDER';
  /** True if the caller took it (and may remove it while the window is open). */
  mine: boolean;
  status: ConditionPhotoStatus;
  /** When the upload was confirmed: the server's time, the evidence. */
  takenAt: string | null;
  /** While READY: links valid until `urlsExpireAt`. */
  urls: ConditionPhotoUrls | null;
  urlsExpireAt: string | null;
}

export interface ConditionPhotosView {
  photos: ConditionPhotoView[];
  /** Whether the caller can add (or remove) photos for each handoff now. */
  canAdd: Record<HandoffPhase, boolean>;
}

// --- requests ---------------------------------------------------------------

export interface ConditionPhotoUploadRequest {
  bookingId: string;
  /** A new random UUID chosen by the client; repeating returns the same upload. */
  photoId: string;
  phase: HandoffPhase;
  contentType: PhotoContentType;
  sizeBytes: number;
}

export interface ConditionPhotoUpload {
  photo: ConditionPhotoView;
  /** PUT the file here with exactly `uploadHeaders`, before `expiresAt`. */
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  expiresAt: string;
}

export interface ConditionPhotoRef {
  bookingId: string;
  photoId: string;
}
