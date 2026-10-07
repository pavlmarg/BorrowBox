import type { EntityManager } from 'typeorm';
import type { PhotoContentType, PhotoStatus } from '@borrowbox/contracts';

/** An `item_photos` row. */
export interface PhotoRow {
  id: string;
  item_id: string;
  status: PhotoStatus;
  position: number;
  upload_key: string;
  content_type: PhotoContentType;
  size_bytes: number;
  public_key: string | null;
  confirmed_at: Date | null;
  created_at: Date;
}

const PHOTO_COLUMNS =
  'id, item_id, status, position, upload_key, content_type, size_bytes,' +
  ' public_key, confirmed_at, created_at';

export async function countPhotos(
  tx: EntityManager,
  itemId: string,
  status?: PhotoStatus,
): Promise<number> {
  const [{ count }] = await tx.query(
    `SELECT count(*)::int AS count FROM item_photos
      WHERE item_id = $1 AND ($2::text IS NULL OR status = $2::text)`,
    [itemId, status ?? null],
  );
  return count;
}

/** At the end of the item's photos (positions are kept 0..n-1). */
export async function insertPendingPhoto(
  tx: EntityManager,
  photo: {
    itemId: string;
    uploadKey: string;
    contentType: PhotoContentType;
    sizeBytes: number;
  },
): Promise<PhotoRow> {
  const [row] = await tx.query(
    `INSERT INTO item_photos (item_id, position, upload_key, content_type, size_bytes)
     VALUES ($1, (SELECT count(*) FROM item_photos WHERE item_id = $1), $2, $3, $4)
     RETURNING ` + PHOTO_COLUMNS,
    [photo.itemId, photo.uploadKey, photo.contentType, photo.sizeBytes],
  );
  return row;
}

/** The item's photo, locked until the transaction ends. */
export async function lockPhoto(
  tx: EntityManager,
  itemId: string,
  photoId: string,
): Promise<PhotoRow | null> {
  const [row] = await tx.query(
    'SELECT ' +
      PHOTO_COLUMNS +
      ' FROM item_photos WHERE id = $1 AND item_id = $2 FOR UPDATE',
    [photoId, itemId],
  );
  return row ?? null;
}

/** Any photo by id, locked (for the worker, which has no item id). */
export async function lockPhotoById(
  tx: EntityManager,
  photoId: string,
): Promise<PhotoRow | null> {
  const [row] = await tx.query(
    'SELECT ' + PHOTO_COLUMNS + ' FROM item_photos WHERE id = $1 FOR UPDATE',
    [photoId],
  );
  return row ?? null;
}

export async function findPhoto(
  tx: EntityManager,
  photoId: string,
): Promise<PhotoRow | null> {
  const [row] = await tx.query(
    'SELECT ' + PHOTO_COLUMNS + ' FROM item_photos WHERE id = $1',
    [photoId],
  );
  return row ?? null;
}

export async function listItemPhotos(
  tx: EntityManager,
  itemId: string,
): Promise<PhotoRow[]> {
  return tx.query(
    'SELECT ' +
      PHOTO_COLUMNS +
      ' FROM item_photos WHERE item_id = $1 ORDER BY position',
    [itemId],
  );
}

export async function markConfirmed(
  tx: EntityManager,
  photoId: string,
): Promise<void> {
  await tx.query(
    `UPDATE item_photos SET confirmed_at = now(), updated_at = now() WHERE id = $1`,
    [photoId],
  );
}

export async function markReady(
  tx: EntityManager,
  photoId: string,
  publicKey: string,
): Promise<void> {
  await tx.query(
    `UPDATE item_photos SET status = 'READY', public_key = $2, updated_at = now()
      WHERE id = $1`,
    [photoId, publicKey],
  );
}

export async function markFailed(
  tx: EntityManager,
  photoId: string,
): Promise<void> {
  await tx.query(
    `UPDATE item_photos SET status = 'FAILED', updated_at = now() WHERE id = $1`,
    [photoId],
  );
}

/** Sets every photo's position; the unique key is checked at commit. */
export async function setPositions(
  tx: EntityManager,
  itemId: string,
  photoIdsInOrder: string[],
): Promise<void> {
  await tx.query(
    `UPDATE item_photos p SET position = o.position - 1, updated_at = now()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, position)
      WHERE p.id = o.id AND p.item_id = $1`,
    [itemId, photoIdsInOrder],
  );
}

// --- removing photos and their files (P5) ---------------------------------------

/**
 * Deletes photos and lists all their files for deletion, in the caller's
 * transaction, so no file is left behind (P5). Remaining photos of the
 * same items close up their positions.
 *
 * @param scope one photo, or every photo of some items
 */
export async function removePhotos(
  tx: EntityManager,
  scope: { photoId: string } | { itemIds: string[] },
): Promise<number> {
  const [photoId, itemIds] =
    'photoId' in scope ? [scope.photoId, null] : [null, scope.itemIds];
  const gone: Array<{ item_id: string; position: number }> = await tx.query(
    `WITH gone AS (
         DELETE FROM item_photos
          WHERE ($1::uuid IS NOT NULL AND id = $1::uuid)
             OR ($2::uuid[] IS NOT NULL AND item_id = ANY($2::uuid[]))
          RETURNING item_id, position, upload_key, public_key
       ), files AS (
         INSERT INTO photo_file_deletions (kind, key)
         SELECT 'UPLOAD', upload_key FROM gone
         UNION ALL
         SELECT 'PUBLIC_PHOTO', public_key FROM gone WHERE public_key IS NOT NULL
         ON CONFLICT (kind, key) DO UPDATE SET not_before = now()
       )
       SELECT item_id, position FROM gone`,
    [photoId, itemIds],
  );
  for (const { item_id, position } of gone) {
    await tx.query(
      `UPDATE item_photos SET position = position - 1, updated_at = now()
        WHERE item_id = $1 AND position > $2`,
      [item_id, position],
    );
  }
  return gone.length;
}

/**
 * Lists files for deletion. With a delay, for files being written right
 * now (the worker cancels it with {@link cancelFileDeletion} once the photo
 * is READY).
 */
export async function scheduleFileDeletion(
  tx: EntityManager,
  kind: 'UPLOAD' | 'PUBLIC_PHOTO',
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
  kind: 'UPLOAD' | 'PUBLIC_PHOTO',
  key: string,
): Promise<void> {
  await tx.query(
    `DELETE FROM photo_file_deletions WHERE kind = $1 AND key = $2`,
    [kind, key],
  );
}

export interface FileDeletionRow {
  id: string;
  kind: 'UPLOAD' | 'PUBLIC_PHOTO';
  key: string;
}

/**
 * Due deletions, locked so concurrent cleanups skip each other's rows.
 * Each failed attempt pushes the next one back (see {@link deferFileDeletion}).
 */
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

// --- the sweeper ---------------------------------------------------------------------

/** Confirmed photos still PENDING after `olderThanSeconds`: processing was interrupted. */
export async function listStalledPhotos(
  tx: EntityManager,
  olderThanSeconds: number,
): Promise<string[]> {
  const rows: Array<{ id: string }> = await tx.query(
    `SELECT id FROM item_photos
      WHERE status = 'PENDING' AND confirmed_at IS NOT NULL
        AND confirmed_at < now() - make_interval(secs => $1::float8)
      ORDER BY confirmed_at
      LIMIT 100`,
    [olderThanSeconds],
  );
  return rows.map((r) => r.id);
}

/** PENDING photos created more than `olderThanSeconds` ago: abandoned. */
export async function listAbandonedPhotos(
  tx: EntityManager,
  olderThanSeconds: number,
): Promise<string[]> {
  const rows: Array<{ id: string }> = await tx.query(
    `SELECT id FROM item_photos
      WHERE status = 'PENDING'
        AND created_at < now() - make_interval(secs => $1::float8)
      ORDER BY created_at
      LIMIT 100`,
    [olderThanSeconds],
  );
  return rows.map((r) => r.id);
}
