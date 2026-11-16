import type { EntityManager } from 'typeorm';
import {
  CONDITION_PHOTO_VARIANTS,
  type ConditionPhotoStatus,
  type HandoffPhase,
  type PhotoContentType,
} from '@borrowbox/contracts';

/** A condition photo (ADR-0027). */
export interface PhotoRow {
  id: string;
  booking_id: string;
  phase: HandoffPhase;
  uploader_id: string;
  status: ConditionPhotoStatus;
  upload_key: string;
  content_type: PhotoContentType;
  size_bytes: number;
  file_key: string | null;
  confirmed_at: Date | null;
  created_at: Date;
}

const SELECT_PHOTOS = `
  SELECT id, booking_id, phase, uploader_id, status, upload_key,
         content_type, size_bytes, file_key, confirmed_at, created_at
    FROM condition_photos`;

/** Where a processed size lives in the evidence bucket. */
export function evidenceObjectKey(fileKey: string, width: number): string {
  return `conditions/${fileKey}/${width}.webp`;
}

/** Every file of a processed photo. */
export function evidenceObjectKeys(fileKey: string): string[] {
  return Object.values(CONDITION_PHOTO_VARIANTS).map((w) =>
    evidenceObjectKey(fileKey, w),
  );
}

export async function insertPhoto(
  tx: EntityManager,
  p: {
    id: string;
    bookingId: string;
    phase: HandoffPhase;
    uploaderId: string;
    uploadKey: string;
    contentType: PhotoContentType;
    sizeBytes: number;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO condition_photos (id, booking_id, phase, uploader_id,
                                   upload_key, content_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      p.id,
      p.bookingId,
      p.phase,
      p.uploaderId,
      p.uploadKey,
      p.contentType,
      p.sizeBytes,
    ],
  );
}

export async function findPhoto(
  tx: EntityManager,
  id: string,
): Promise<PhotoRow | null> {
  const [row] = await tx.query(SELECT_PHOTOS + ' WHERE id = $1', [id]);
  return row ?? null;
}

/** Locks the photo's row until the transaction ends, then reads it. */
export async function lockPhoto(
  tx: EntityManager,
  id: string,
): Promise<PhotoRow | null> {
  const [row] = await tx.query(SELECT_PHOTOS + ' WHERE id = $1 FOR UPDATE', [
    id,
  ]);
  return row ?? null;
}

/** A booking's photos, oldest first. */
export async function listPhotos(
  tx: EntityManager,
  bookingId: string,
): Promise<PhotoRow[]> {
  return tx.query(
    SELECT_PHOTOS + ' WHERE booking_id = $1 ORDER BY created_at, id',
    [bookingId],
  );
}

/** Photos that count towards the limit: waiting or ready, not failed. */
export async function countPhotos(
  tx: EntityManager,
  bookingId: string,
  phase: HandoffPhase,
  uploaderId: string,
): Promise<number> {
  const [row] = await tx.query(
    `SELECT count(*)::int AS n FROM condition_photos
      WHERE booking_id = $1 AND phase = $2 AND uploader_id = $3
        AND status <> 'FAILED'`,
    [bookingId, phase, uploaderId],
  );
  return row.n;
}

export async function markConfirmed(
  tx: EntityManager,
  id: string,
): Promise<void> {
  await tx.query(
    `UPDATE condition_photos
        SET confirmed_at = date_trunc('milliseconds', now()), updated_at = now()
      WHERE id = $1 AND confirmed_at IS NULL`,
    [id],
  );
}

export async function setReady(
  tx: EntityManager,
  id: string,
  fileKey: string,
): Promise<void> {
  await tx.query(
    `UPDATE condition_photos
        SET status = 'READY', file_key = $2, updated_at = now()
      WHERE id = $1`,
    [id, fileKey],
  );
}

/** Unusable: the row stays FAILED for the uploader to see; the original goes. */
export async function markFailed(
  tx: EntityManager,
  photo: PhotoRow,
): Promise<void> {
  await tx.query(
    `UPDATE condition_photos SET status = 'FAILED', updated_at = now()
      WHERE id = $1`,
    [photo.id],
  );
  await scheduleFileDeletion(tx, 'UPLOAD', photo.upload_key);
}

/** Deletes the row and lists all its files for deletion. */
export async function removePhoto(
  tx: EntityManager,
  photo: Pick<PhotoRow, 'id' | 'upload_key' | 'file_key'>,
): Promise<void> {
  await tx.query(`DELETE FROM condition_photos WHERE id = $1`, [photo.id]);
  await scheduleFileDeletion(tx, 'UPLOAD', photo.upload_key);
  if (photo.file_key) {
    await scheduleFileDeletion(tx, 'EVIDENCE', photo.file_key);
  }
}

/** Every photo the user took (account erasure). @returns how many */
export async function removePhotosOf(
  tx: EntityManager,
  uploaderId: string,
): Promise<number> {
  const rows: PhotoRow[] = await tx.query(
    SELECT_PHOTOS + ' WHERE uploader_id = $1 FOR UPDATE',
    [uploaderId],
  );
  for (const row of rows) await removePhoto(tx, row);
  return rows.length;
}

/** The user's own photos, for `GET /me/export`. */
export async function listPhotosOf(
  tx: EntityManager,
  uploaderId: string,
): Promise<PhotoRow[]> {
  return tx.query(
    SELECT_PHOTOS + ' WHERE uploader_id = $1 ORDER BY created_at, id',
    [uploaderId],
  );
}

// --- deleting files (the same outbox as Catalog's and Identity's, ADR-0009) -------------

export type FileKind = 'UPLOAD' | 'EVIDENCE';

/**
 * Lists files for deletion. With a delay, for files being written right
 * now (the worker cancels it with {@link cancelFileDeletion} once they are
 * the photo's).
 */
export async function scheduleFileDeletion(
  tx: EntityManager,
  kind: FileKind,
  key: string,
  delaySeconds = 0,
): Promise<void> {
  await tx.query(
    `INSERT INTO photo_file_deletions (kind, key, not_before)
     VALUES ($1, $2, now() + make_interval(secs => $3::float8))
     ON CONFLICT (kind, key) DO UPDATE SET not_before = EXCLUDED.not_before`,
    [kind, key, delaySeconds],
  );
}

export async function cancelFileDeletion(
  tx: EntityManager,
  kind: FileKind,
  key: string,
): Promise<void> {
  await tx.query(
    `DELETE FROM photo_file_deletions WHERE kind = $1 AND key = $2`,
    [kind, key],
  );
}

export interface FileDeletionRow {
  id: string;
  kind: FileKind;
  key: string;
}

/** Due deletions, locked so concurrent cleanups skip each other's rows. */
export async function lockDueFileDeletions(
  tx: EntityManager,
  limit: number,
): Promise<FileDeletionRow[]> {
  return tx.query(
    `SELECT id, kind, key FROM photo_file_deletions
      WHERE not_before <= now()
      ORDER BY not_before, id
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [limit],
  );
}

export async function finishFileDeletion(
  tx: EntityManager,
  id: string,
): Promise<void> {
  await tx.query(`DELETE FROM photo_file_deletions WHERE id = $1`, [id]);
}

/** Backs off: 1, 2, 4 … minutes, at most an hour. */
export async function deferFileDeletion(
  tx: EntityManager,
  id: string,
): Promise<void> {
  await tx.query(
    `UPDATE photo_file_deletions
        SET attempts = attempts + 1,
            not_before = now() + least(interval '1 hour',
                                       interval '1 minute' * power(2, attempts))
      WHERE id = $1`,
    [id],
  );
}

export async function hasDueFileDeletions(tx: EntityManager): Promise<boolean> {
  const rows: unknown[] = await tx.query(
    `SELECT 1 FROM photo_file_deletions WHERE not_before <= now() LIMIT 1`,
  );
  return rows.length > 0;
}

// --- the sweeper ------------------------------------------------------------------------

/** Confirmed uploads still `PENDING` after `olderThanSeconds`: processing was interrupted. */
export async function listStalledUploads(
  tx: EntityManager,
  olderThanSeconds: number,
): Promise<string[]> {
  const rows: Array<{ id: string }> = await tx.query(
    `SELECT id FROM condition_photos
      WHERE status = 'PENDING' AND confirmed_at IS NOT NULL
        AND confirmed_at < now() - make_interval(secs => $1::float8)
      ORDER BY confirmed_at
      LIMIT 100`,
    [olderThanSeconds],
  );
  return rows.map((r) => r.id);
}

/**
 * Uploads never confirmed, or rejected, more than `olderThanSeconds` ago:
 * the uploader has moved on.
 */
export async function listAbandonedUploads(
  tx: EntityManager,
  olderThanSeconds: number,
): Promise<string[]> {
  const rows: Array<{ id: string }> = await tx.query(
    `SELECT id FROM condition_photos
      WHERE ((status = 'PENDING' AND confirmed_at IS NULL) OR status = 'FAILED')
        AND created_at < now() - make_interval(secs => $1::float8)
      ORDER BY created_at
      LIMIT 100`,
    [olderThanSeconds],
  );
  return rows.map((r) => r.id);
}

/** Statuses after which a booking changes no more. */
const FINISHED = ['COMPLETED', 'EXPIRED', 'CANCELLED', 'DECLINED'];

/**
 * Photos of bookings that finished more than `days` ago (ADR-0027's
 * retention). A booking's `updated_at` is its last change, which for a
 * finished one is when it finished.
 */
export async function listExpiredPhotos(
  tx: EntityManager,
  days: number,
  limit: number,
): Promise<string[]> {
  const rows: Array<{ id: string }> = await tx.query(
    `SELECT p.id FROM condition_photos p
       JOIN bookings b ON b.id = p.booking_id
      WHERE b.status = ANY($1::text[])
        AND b.updated_at < now() - make_interval(days => $2::int)
      ORDER BY p.created_at
      LIMIT $3::int`,
    [FINISHED, days, limit],
  );
  return rows.map((r) => r.id);
}
