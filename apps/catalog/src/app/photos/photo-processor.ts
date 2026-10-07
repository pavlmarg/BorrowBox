import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  PHOTO_MIN_WIDTH_PX,
  PHOTO_VARIANTS,
} from '@borrowbox/contracts';
import {
  InvalidImageError,
  ObjectTooLargeError,
  processImage,
  type ProcessedImage,
} from '@borrowbox/media';
import { DATA_SOURCE } from '../database/database.module';
import { PhotoQueue } from './photo-queue';
import { PhotoStorage } from './photo-storage';
import {
  cancelFileDeletion,
  findPhoto,
  lockPhotoById,
  markFailed,
  markReady,
  scheduleFileDeletion,
} from './photos.repository';

/** Decoded pixels allowed per photo: guards against decompression bombs. */
export const PHOTO_MAX_PIXELS = 50_000_000;
/**
 * How long the worker's own files are protected from cleanup while it
 * writes them. Processing takes seconds; this only matters after a crash.
 */
const WRITE_GRACE_SECONDS = 15 * 60;

/**
 * Turns a confirmed upload into public, metadata-free sizes (ADR-0009):
 * 1. re-check the photo is still PENDING (skip otherwise);
 * 2. read the upload and process it; an unusable image ends FAILED;
 * 3. list the new public files for deletion (delayed), write them;
 * 4. in one transaction: if the photo is still PENDING, mark it READY,
 *    keep the files and list the original for deletion; if it was deleted
 *    meanwhile, let the new files be deleted.
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
      const upload = await this.storage.readUpload(photo.upload_key);
      if (!upload) throw new InvalidImageError('UNREADABLE');
      processed = await processImage(upload, {
        declaredType: photo.content_type,
        allowedTypes: PHOTO_CONTENT_TYPES,
        maxBytes: PHOTO_MAX_BYTES,
        maxPixels: PHOTO_MAX_PIXELS,
        minWidth: PHOTO_MIN_WIDTH_PX,
        widths: PHOTO_VARIANTS,
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

    const publicKey = randomUUID();
    await this.dataSource.transaction((tx) =>
      scheduleFileDeletion(tx, 'PUBLIC_PHOTO', publicKey, WRITE_GRACE_SECONDS),
    );
    await this.storage.writePublicSizes(publicKey, processed.sizes);

    const ready = await this.dataSource.transaction(async (tx) => {
      const current = await lockPhotoById(tx, photoId);
      if (!current || current.status !== 'PENDING') {
        // Deleted (or handled) meanwhile: the new files go too.
        await scheduleFileDeletion(tx, 'PUBLIC_PHOTO', publicKey);
        return false;
      }
      await markReady(tx, photoId, publicKey);
      await cancelFileDeletion(tx, 'PUBLIC_PHOTO', publicKey);
      await scheduleFileDeletion(tx, 'UPLOAD', current.upload_key);
      return true;
    });
    if (ready) this.logger.log(`Photo ${photoId} ready`);
    await this.queue.cleanup();
  }

  /** P2: the row stays FAILED for the owner to see; the original goes. */
  private async fail(photoId: string, reason: string): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const current = await lockPhotoById(tx, photoId);
      if (!current || current.status !== 'PENDING') return;
      await markFailed(tx, photoId);
      await scheduleFileDeletion(tx, 'UPLOAD', current.upload_key);
    });
    this.logger.warn(`Photo ${photoId} rejected: ${reason}`);
    await this.queue.cleanup();
  }
}
