import type { EntityManager } from 'typeorm';
import {
  PROFILE_PHOTO_VARIANTS,
  type PhotoContentType,
  type ProfilePhotoUploadStatus,
  type ProfilePhotoUrls,
} from '@borrowbox/contracts';

/**
 * Profile photos' tables (ADR-0024). Lock order everywhere: the user's row
 * (`users … FOR UPDATE`), then their `user_photos` row.
 */

// --- where the files live ---------------------------------------------------------

/** A processed size in the public bucket. Keys are random and never reused. */
export function profilePhotoObjectKey(publicKey: string, edge: number): string {
  return `profiles/${publicKey}/${edge}.webp`;
}

export function profilePhotoUrls(
  baseUrl: string,
  publicKey: string,
): ProfilePhotoUrls {
  const url = (edge: number) =>
    `${baseUrl}/${profilePhotoObjectKey(publicKey, edge)}`;
  return {
    small: url(PROFILE_PHOTO_VARIANTS.small),
    large: url(PROFILE_PHOTO_VARIANTS.large),
  };
}

// --- the waiting upload ------------------------------------------------------------

/** A `user_photos` row: the user's new photo, not shown yet. */
export interface UploadRow {
  id: string;
  user_id: string;
  status: ProfilePhotoUploadStatus;
  upload_key: string;
  content_type: PhotoContentType;
  size_bytes: number;
  confirmed_at: Date | null;
  created_at: Date;
}

const UPLOAD_COLUMNS =
  'id, user_id, status, upload_key, content_type, size_bytes, confirmed_at, created_at';

/** The live user's row, locked; null if missing or deleted. */
export async function lockLiveUser(
  tx: EntityManager,
  userId: string,
): Promise<{ photo_key: string | null } | null> {
  const [row] = await tx.query(
    `SELECT photo_key FROM users
      WHERE id = $1 AND deleted_at IS NULL
      FOR UPDATE`,
    [userId],
  );
  return row ?? null;
}

/**
 * A new upload, replacing any upload still waiting (its file is listed for
 * deletion). Call with the user's row locked.
 */
export async function replaceUpload(
  tx: EntityManager,
  upload: {
    userId: string;
    uploadKey: string;
    contentType: PhotoContentType;
    sizeBytes: number;
  },
): Promise<UploadRow> {
  await removeUpload(tx, upload.userId);
  const [row] = await tx.query(
    `INSERT INTO user_photos (user_id, upload_key, content_type, size_bytes)
     VALUES ($1, $2, $3, $4)
     RETURNING ` + UPLOAD_COLUMNS,
    [upload.userId, upload.uploadKey, upload.contentType, upload.sizeBytes],
  );
  return row;
}

export async function lockUploadOfUser(
  tx: EntityManager,
  userId: string,
): Promise<UploadRow | null> {
  const [row] = await tx.query(
    'SELECT ' +
      UPLOAD_COLUMNS +
      ' FROM user_photos WHERE user_id = $1 FOR UPDATE',
    [userId],
  );
  return row ?? null;
}

/** By id, locked (for the worker and the sweeper). */
export async function lockUpload(
  tx: EntityManager,
  uploadId: string,
): Promise<UploadRow | null> {
  const [row] = await tx.query(
    'SELECT ' + UPLOAD_COLUMNS + ' FROM user_photos WHERE id = $1 FOR UPDATE',
    [uploadId],
  );
  return row ?? null;
}

export async function findUpload(
  tx: EntityManager,
  uploadId: string,
): Promise<UploadRow | null> {
  const [row] = await tx.query(
    'SELECT ' + UPLOAD_COLUMNS + ' FROM user_photos WHERE id = $1',
    [uploadId],
  );
  return row ?? null;
}

export async function markConfirmed(
  tx: EntityManager,
  uploadId: string,
): Promise<void> {
  await tx.query(
    `UPDATE user_photos SET confirmed_at = now(), updated_at = now() WHERE id = $1`,
    [uploadId],
  );
}

/** Unusable: the row stays `FAILED` for the user to see; the file goes. */
export async function markFailed(
  tx: EntityManager,
  upload: Pick<UploadRow, 'id' | 'upload_key'>,
): Promise<void> {
  await tx.query(
    `UPDATE user_photos SET status = 'FAILED', updated_at = now() WHERE id = $1`,
    [upload.id],
  );
  await scheduleFileDeletion(tx, 'UPLOAD', upload.upload_key);
}

/** Deletes the user's waiting upload, if any, and lists its file for deletion. */
export async function removeUpload(
  tx: EntityManager,
  userId: string,
): Promise<void> {
  await tx.query(
    `WITH gone AS (
       DELETE FROM user_photos WHERE user_id = $1 RETURNING upload_key
     )
     INSERT INTO photo_file_deletions (kind, key)
     SELECT 'UPLOAD', upload_key FROM gone
     ON CONFLICT (kind, key) DO UPDATE SET not_before = now()`,
    [userId],
  );
}

// --- the current photo ---------------------------------------------------------------

/**
 * Makes `publicKey` the user's photo and lists the previous one's files for
 * deletion. Call with the user's row locked.
 */
export async function setPhoto(
  tx: EntityManager,
  userId: string,
  previousKey: string | null,
  publicKey: string,
): Promise<void> {
  await tx.query(
    `UPDATE users SET photo_key = $2, updated_at = now() WHERE id = $1`,
    [userId, publicKey],
  );
  if (previousKey) await scheduleFileDeletion(tx, 'PUBLIC_PHOTO', previousKey);
}

/**
 * Removes the photo and any waiting upload, listing all their files for
 * deletion in the caller's transaction (account erasure, "Remove photo").
 *
 * @returns true if there was a photo, i.e. others must be told
 */
export async function removeUserPhotos(
  tx: EntityManager,
  userId: string,
): Promise<boolean> {
  await removeUpload(tx, userId);
  // The caller holds the row lock, so reading first and then updating is safe.
  const [row]: Array<{ photo_key: string | null }> = await tx.query(
    `SELECT photo_key FROM users WHERE id = $1`,
    [userId],
  );
  if (!row?.photo_key) return false;
  await tx.query(
    `UPDATE users SET photo_key = NULL, updated_at = now() WHERE id = $1`,
    [userId],
  );
  await scheduleFileDeletion(tx, 'PUBLIC_PHOTO', row.photo_key);
  return true;
}

// --- deleting files (the same outbox as Catalog's, ADR-0009) ----------------------------

export type FileKind = 'UPLOAD' | 'PUBLIC_PHOTO';

/**
 * Lists files for deletion. With a delay, for files being written right
 * now (the worker cancels it with {@link cancelFileDeletion} once they are
 * the user's photo).
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
    `SELECT id FROM user_photos
      WHERE status = 'PENDING' AND confirmed_at IS NOT NULL
        AND confirmed_at < now() - make_interval(secs => $1::float8)
      ORDER BY confirmed_at
      LIMIT 100`,
    [olderThanSeconds],
  );
  return rows.map((r) => r.id);
}

/**
 * Uploads started more than `olderThanSeconds` ago and never finished, or
 * rejected that long ago: the user has moved on.
 */
export async function listAbandonedUploads(
  tx: EntityManager,
  olderThanSeconds: number,
): Promise<Array<{ id: string; user_id: string }>> {
  return tx.query(
    `SELECT id, user_id FROM user_photos
      WHERE created_at < now() - make_interval(secs => $1::float8)
      ORDER BY created_at
      LIMIT 100`,
    [olderThanSeconds],
  );
}
