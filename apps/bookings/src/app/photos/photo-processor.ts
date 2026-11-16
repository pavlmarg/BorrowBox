import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  CONDITION_PHOTO_VARIANTS,
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  PHOTO_MIN_WIDTH_PX,
} from '@borrowbox/contracts';
import {
  InvalidImageError,
  ObjectTooLargeError,
  processImage,
  type ProcessedImage,
} from '@borrowbox/media';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { PhotoQueue } from './photo-queue';
import { PhotoStorage } from './photo-storage';
import {
  cancelFileDeletion,
  findPhoto,
  lockPhoto,
  markFailed,
  scheduleFileDeletion,
  setReady,
} from './photos.repository';

/** Decoded pixels allowed per photo: guards against decompression bombs. */
export const PHOTO_MAX_PIXELS = 50_000_000;
/**
 * How long the worker's own files are protected from cleanup while it
 * writes them. Processing takes seconds; this only matters after a crash.
 */
const WRITE_GRACE_SECONDS = 15 * 60;

/**
 * Turns a confirmed upload into a condition photo (ADR-0027):
 * 1. re-check the photo is still PENDING and confirmed (skip otherwise);
 * 2. read and process it into metadata-free sizes; an unusable image ends
 *    FAILED;
 * 3. list the new files for deletion (delayed), write them;
 * 4. in one transaction: if the photo is still waiting, make the files its
 *    own and list the original for deletion; if it was removed meanwhile
 *    (by its uploader, an erasure or retention), let the new files go.
 * Storage or database errors throw, so the job is retried.
 */
@Injectable()
export class PhotoProcessor {
  private readonly logger = new Logger('PhotoProcessor');

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly storage: PhotoStorage,
    private readonly queue: PhotoQueue,
  ) {}

  async process(photoId: string): Promise<void> {
    const photo = await findPhoto(this.dataSource.manager, photoId);
    if (!photo || photo.status !== 'PENDING' || !photo.confirmed_at) return;

    let processed: ProcessedImage;
    try {
      const file = await this.storage.readUpload(photo.upload_key);
      if (!file) throw new InvalidImageError('UNREADABLE');
      processed = await processImage(file, {
        declaredType: photo.content_type,
        allowedTypes: PHOTO_CONTENT_TYPES,
        maxBytes: PHOTO_MAX_BYTES,
        maxPixels: PHOTO_MAX_PIXELS,
        minWidth: PHOTO_MIN_WIDTH_PX,
        widths: CONDITION_PHOTO_VARIANTS,
      });
    } catch (err) {
      if (
        err instanceof InvalidImageError ||
        err instanceof ObjectTooLargeError
      ) {
        await this.fail(
          photoId,
          err instanceof InvalidImageError ? err.reason : 'TOO_LARGE',
        );
        return;
      }
      throw err;
    }

    const fileKey = randomUUID();
    await this.dataSource.transaction((tx) =>
      scheduleFileDeletion(tx, 'EVIDENCE', fileKey, WRITE_GRACE_SECONDS),
    );
    await this.storage.writeEvidence(fileKey, processed.sizes);

    const ready = await this.dataSource.transaction(async (tx) => {
      const current = await lockPhoto(tx, photoId);
      if (!current || current.status !== 'PENDING') {
        // Removed meanwhile: the new files go too.
        await scheduleFileDeletion(tx, 'EVIDENCE', fileKey);
        return false;
      }
      await setReady(tx, photoId, fileKey);
      await cancelFileDeletion(tx, 'EVIDENCE', fileKey);
      await scheduleFileDeletion(tx, 'UPLOAD', current.upload_key);
      return true;
    });
    if (ready) this.logger.log(`Condition photo ${photoId} ready`);
    await this.queue.cleanup();
  }

  private async fail(photoId: string, reason: string): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const current = await lockPhoto(tx, photoId);
      if (!current || current.status !== 'PENDING') return;
      await markFailed(tx, current);
    });
    this.logger.warn(`Condition photo ${photoId} rejected: ${reason}`);
    await this.queue.cleanup();
  }
}
