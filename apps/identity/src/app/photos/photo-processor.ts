import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import {
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  PROFILE_PHOTO_MIN_PX,
  PROFILE_PHOTO_VARIANTS,
} from '@borrowbox/contracts';
import {
  InvalidImageError,
  ObjectTooLargeError,
  processImage,
  type ProcessedImage,
} from '@borrowbox/media';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import type { IdentityConfig } from '../config';
import { announceProfile } from '../users/user-profile';
import { PhotoQueue } from './photo-queue';
import { PhotoStorage } from './photo-storage';
import {
  cancelFileDeletion,
  findUpload,
  lockLiveUser,
  lockUpload,
  markFailed,
  scheduleFileDeletion,
  setPhoto,
} from './photos.repository';

/** Decoded pixels allowed per photo: guards against decompression bombs. */
export const PHOTO_MAX_PIXELS = 50_000_000;
/**
 * How long the worker's own files are protected from cleanup while it
 * writes them. Processing takes seconds; this only matters after a crash.
 */
const WRITE_GRACE_SECONDS = 15 * 60;

/**
 * Turns a confirmed upload into the user's profile photo (ADR-0024):
 * 1. re-check the upload is still PENDING and confirmed (skip otherwise);
 * 2. read and process it into square, metadata-free sizes; an unusable
 *    image ends FAILED;
 * 3. list the new public files for deletion (delayed), write them;
 * 4. in one transaction, with the user's row locked: if the upload is still
 *    waiting, make the files the photo, list the old photo and the original
 *    for deletion, drop the upload row and announce the change; if it was
 *    replaced, removed or the account deleted meanwhile, let the new files go.
 * Storage or database errors throw, so the job is retried.
 */
@Injectable()
export class PhotoProcessor {
  private readonly logger = new Logger('PhotoProcessor');
  private readonly photosBaseUrl: string;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly storage: PhotoStorage,
    private readonly queue: PhotoQueue,
    config: ConfigService<IdentityConfig, true>,
  ) {
    this.photosBaseUrl = config.get('PHOTOS_BASE_URL', { infer: true });
  }

  async process(uploadId: string): Promise<void> {
    const upload = await findUpload(this.dataSource.manager, uploadId);
    if (!upload || upload.status !== 'PENDING' || !upload.confirmed_at) return;

    let processed: ProcessedImage;
    try {
      const file = await this.storage.readUpload(upload.upload_key);
      if (!file) throw new InvalidImageError('UNREADABLE');
      processed = await processImage(file, {
        declaredType: upload.content_type,
        allowedTypes: PHOTO_CONTENT_TYPES,
        maxBytes: PHOTO_MAX_BYTES,
        maxPixels: PHOTO_MAX_PIXELS,
        minWidth: PROFILE_PHOTO_MIN_PX,
        widths: PROFILE_PHOTO_VARIANTS,
        square: true,
      });
    } catch (err) {
      if (
        err instanceof InvalidImageError ||
        err instanceof ObjectTooLargeError
      ) {
        await this.fail(
          uploadId,
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
      // The user's row first, then the upload: the same order as the commands.
      const user = await lockLiveUser(tx, upload.user_id);
      const current = await lockUpload(tx, uploadId);
      if (!user || !current || current.status !== 'PENDING') {
        // Replaced, removed or erased meanwhile: the new files go too.
        await scheduleFileDeletion(tx, 'PUBLIC_PHOTO', publicKey);
        return false;
      }
      await setPhoto(tx, upload.user_id, user.photo_key, publicKey);
      await cancelFileDeletion(tx, 'PUBLIC_PHOTO', publicKey);
      await tx.query(`DELETE FROM user_photos WHERE id = $1`, [uploadId]);
      await scheduleFileDeletion(tx, 'UPLOAD', current.upload_key);
      await announceProfile(tx, upload.user_id, this.photosBaseUrl);
      return true;
    });
    if (ready) this.logger.log(`Profile photo ${uploadId} ready`);
    await this.queue.cleanup();
  }

  /** The row stays FAILED for the user to see; the original goes. */
  private async fail(uploadId: string, reason: string): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const current = await lockUpload(tx, uploadId);
      if (!current || current.status !== 'PENDING') return;
      await markFailed(tx, current);
    });
    this.logger.warn(`Profile photo ${uploadId} rejected: ${reason}`);
    await this.queue.cleanup();
  }
}
