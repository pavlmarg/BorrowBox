import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { PhotoQueue } from './photo-queue';
import { PhotoStorage } from './photo-storage';
import {
  deferFileDeletion,
  finishFileDeletion,
  hasDueFileDeletions,
  listAbandonedUploads,
  listStalledUploads,
  lockDueFileDeletions,
  lockUploadOfUser,
  removeUpload,
} from './photos.repository';

/** A confirmed upload still PENDING this long had its processing interrupted. */
export const STALLED_AFTER_SECONDS = 5 * 60;
/** Unfinished or rejected uploads this old are dropped (ADR-0009's day). */
export const ABANDONED_AFTER_SECONDS = 24 * 60 * 60;
const CLEANUP_BATCH = 50;

/**
 * Cleanup and recovery for profile photos, like Catalog's for item photos
 * (ADR-0009). Both are safe to run at any time, repeatedly and concurrently.
 */
@Injectable()
export class PhotoMaintenance {
  private readonly logger = new Logger('PhotoMaintenance');

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly storage: PhotoStorage,
    private readonly queue: PhotoQueue,
  ) {}

  /**
   * Deletes the files of due `photo_file_deletions` entries, then the
   * entries. A failure backs that entry off and moves on; the sweeper
   * comes back for it.
   *
   * @returns how many entries were completed
   */
  async cleanup(): Promise<number> {
    let done = 0;
    for (;;) {
      const batch = await this.dataSource.transaction(async (tx) => {
        const rows = await lockDueFileDeletions(tx, CLEANUP_BATCH);
        for (const row of rows) {
          try {
            await this.storage.deleteFiles(row.kind, row.key);
            await finishFileDeletion(tx, row.id);
            done++;
          } catch (err) {
            await deferFileDeletion(tx, row.id);
            this.logger.warn(
              `Could not delete files (entry ${row.id}): ${err instanceof Error ? err.name : 'unknown'}`,
            );
          }
        }
        return rows.length;
      });
      if (batch < CLEANUP_BATCH) return done;
    }
  }

  /**
   * Runs every 10 minutes:
   * - re-queues confirmed uploads whose processing was interrupted;
   * - drops abandoned or long-rejected uploads (row and file);
   * - queues a cleanup if any file deletions are due.
   */
  async sweep(): Promise<{ requeued: number; abandoned: number }> {
    const db = this.dataSource.manager;
    const stalled = await listStalledUploads(db, STALLED_AFTER_SECONDS);
    for (const uploadId of stalled) await this.queue.process(uploadId);

    let abandoned = 0;
    for (const { id, user_id } of await listAbandonedUploads(
      db,
      ABANDONED_AFTER_SECONDS,
    )) {
      const removed = await this.dataSource.transaction(async (tx) => {
        // The user's row first, then the upload: the same order as the commands.
        await tx.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [
          user_id,
        ]);
        const current = await lockUploadOfUser(tx, user_id);
        if (!current || current.id !== id) return false; // replaced meanwhile
        await removeUpload(tx, user_id);
        return true;
      });
      if (removed) abandoned++;
    }

    if (await hasDueFileDeletions(db)) await this.queue.cleanup();
    if (stalled.length > 0 || abandoned > 0) {
      this.logger.log(
        `Sweep: re-queued ${stalled.length}, dropped ${abandoned} abandoned upload(s)`,
      );
    }
    return { requeued: stalled.length, abandoned };
  }
}
