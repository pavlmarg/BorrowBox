import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { CONDITION_PHOTO_RETENTION_DAYS } from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { PhotoQueue } from './photo-queue';
import { PhotoStorage } from './photo-storage';
import {
  deferFileDeletion,
  finishFileDeletion,
  hasDueFileDeletions,
  listAbandonedUploads,
  listExpiredPhotos,
  listStalledUploads,
  lockDueFileDeletions,
  lockPhoto,
  removePhoto,
} from './photos.repository';

/** A confirmed upload still PENDING this long had its processing interrupted. */
export const STALLED_AFTER_SECONDS = 5 * 60;
/** Unfinished or rejected uploads this old are dropped (ADR-0009's day). */
export const ABANDONED_AFTER_SECONDS = 24 * 60 * 60;
const CLEANUP_BATCH = 50;
const RETENTION_BATCH = 200;

/**
 * Cleanup, recovery and retention for condition photos (ADR-0027), like
 * Catalog's and Identity's for their photos. Safe to run at any time,
 * repeatedly and concurrently.
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
   * - drops abandoned or rejected uploads (row and file) after a day;
   * - deletes the photos of bookings that finished 30 days ago;
   * - queues a cleanup if any file deletions are due.
   */
  async sweep(): Promise<{
    requeued: number;
    abandoned: number;
    expired: number;
  }> {
    const db = this.dataSource.manager;
    const stalled = await listStalledUploads(db, STALLED_AFTER_SECONDS);
    for (const photoId of stalled) await this.queue.process(photoId);

    const abandoned = await this.removeAll(
      await listAbandonedUploads(db, ABANDONED_AFTER_SECONDS),
    );
    const expired = await this.removeAll(
      await listExpiredPhotos(
        db,
        CONDITION_PHOTO_RETENTION_DAYS,
        RETENTION_BATCH,
      ),
    );

    if (await hasDueFileDeletions(db)) await this.queue.cleanup();
    if (stalled.length > 0 || abandoned > 0 || expired > 0) {
      this.logger.log(
        `Sweep: re-queued ${stalled.length}, dropped ${abandoned} abandoned upload(s), deleted ${expired} expired photo(s)`,
      );
    }
    return { requeued: stalled.length, abandoned, expired };
  }

  /** Removes each photo still there; one transaction each. */
  private async removeAll(ids: string[]): Promise<number> {
    let removed = 0;
    for (const id of ids) {
      const done = await this.dataSource.transaction(async (tx) => {
        const photo = await lockPhoto(tx, id);
        if (!photo) return false;
        await removePhoto(tx, photo);
        return true;
      });
      if (done) removed++;
    }
    return removed;
  }
}
