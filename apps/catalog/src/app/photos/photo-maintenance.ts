import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATA_SOURCE } from '../database/database.module';
import { PhotoQueue } from './photo-queue';
import { PhotoStorage } from './photo-storage';
import {
  deferFileDeletion,
  finishFileDeletion,
  hasDueFileDeletions,
  listAbandonedPhotos,
  listStalledPhotos,
  lockDueFileDeletions,
  lockPhotoById,
  removePhotos,
} from './photos.repository';

/** A confirmed photo still PENDING this long had its processing interrupted. */
export const STALLED_AFTER_SECONDS = 5 * 60;
/** An unconfirmed (or never-finished) upload this old is abandoned (ADR-0009). */
export const ABANDONED_AFTER_SECONDS = 24 * 60 * 60;
const CLEANUP_BATCH = 50;

/**
 * Cleanup and recovery for the photo pipeline (ADR-0009, P5). Both are
 * safe to run at any time, repeatedly and concurrently.
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
   * - re-queues confirmed photos whose processing was interrupted;
   * - removes abandoned PENDING photos (row and files);
   * - queues a cleanup if any file deletions are due.
   */
  async sweep(): Promise<{ requeued: number; abandoned: number }> {
    const tx = this.dataSource.manager;
    const stalled = await listStalledPhotos(tx, STALLED_AFTER_SECONDS);
    for (const photoId of stalled) await this.queue.process(photoId);

    let abandoned = 0;
    for (const photoId of await listAbandonedPhotos(
      tx,
      ABANDONED_AFTER_SECONDS,
    )) {
      const removed = await this.dataSource.transaction(async (t) => {
        // Item first, then photo: the same lock order as the commands.
        const [photo] = await t.query(
          `SELECT item_id FROM item_photos WHERE id = $1`,
          [photoId],
        );
        if (!photo) return false;
        await t.query(`SELECT 1 FROM items WHERE id = $1 FOR UPDATE`, [
          photo.item_id,
        ]);
        const current = await lockPhotoById(t, photoId);
        if (!current || current.status !== 'PENDING') return false;
        await removePhotos(t, { photoId });
        return true;
      });
      if (removed) abandoned++;
    }

    if (await hasDueFileDeletions(tx)) await this.queue.cleanup();
    if (stalled.length > 0 || abandoned > 0) {
      this.logger.log(
        `Sweep: re-queued ${stalled.length}, removed ${abandoned} abandoned photo(s)`,
      );
    }
    return { requeued: stalled.length, abandoned };
  }
}
