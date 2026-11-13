import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '@borrowbox/auth';
import type { ProfilePhotoUpload, UserProfile } from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import type { IdentityConfig } from '../config';
import { IdentityError } from '../rpc/rpc-errors';
import { assertLiveSession } from '../users/live-session';
import { announceProfile, loadProfile } from '../users/user-profile';
import { PhotoQueue } from './photo-queue';
import { PhotoStorage } from './photo-storage';
import type { ProfilePhotoUploadDto } from './photos.dto';
import {
  lockLiveUser,
  lockUploadOfUser,
  markConfirmed,
  removeUserPhotos,
  replaceUpload,
} from './photos.repository';

const UNAUTHENTICATED = () =>
  new IdentityError('UNAUTHENTICATED', 'Authentication required');

/**
 * The signed-in user's profile photo (ADR-0024): start an upload, confirm
 * it, remove the photo. Every command locks the user's row first.
 */
@Injectable()
export class PhotosService {
  private readonly photosBaseUrl: string;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly storage: PhotoStorage,
    private readonly queue: PhotoQueue,
    config: ConfigService<IdentityConfig, true>,
  ) {
    this.photosBaseUrl = config.get('PHOTOS_BASE_URL', { infer: true });
  }

  /**
   * A new waiting upload (replacing any other) and a presigned URL for the
   * browser to put the file at. The current photo stays until it's ready.
   */
  async requestUpload(
    auth: AuthUser,
    dto: ProfilePhotoUploadDto,
  ): Promise<ProfilePhotoUpload> {
    const upload = await this.dataSource.transaction(async (tx) => {
      await this.lockUser(tx, auth);
      return replaceUpload(tx, {
        userId: auth.userId,
        uploadKey: `incoming/${randomUUID()}`,
        contentType: dto.contentType,
        sizeBytes: dto.sizeBytes,
      });
    });
    // After the commit: a row exists for every URL ever issued, so the
    // sweeper can always find and remove an abandoned upload.
    await this.queue.cleanup(); // the replaced upload's file, if any
    const presigned = await this.storage.presignUpload(
      upload.upload_key,
      dto.contentType,
    );
    return {
      uploadUrl: presigned.url,
      uploadHeaders: presigned.headers,
      expiresAt: presigned.expiresAt.toISOString(),
    };
  }

  /**
   * The browser's upload has finished: queue processing. Repeating it is
   * safe; confirming before the file arrived, or with nothing waiting, is
   * refused.
   */
  async confirm(auth: AuthUser): Promise<UserProfile> {
    const queued = await this.dataSource.transaction(async (tx) => {
      await this.lockUser(tx, auth);
      const upload = await lockUploadOfUser(tx, auth.userId);
      if (!upload || upload.status !== 'PENDING') {
        throw new IdentityError('INVALID_STATE', 'No photo upload is waiting');
      }
      if ((await this.storage.uploadSize(upload.upload_key)) === null) {
        throw new IdentityError(
          'INVALID_STATE',
          "The photo hasn't been uploaded yet",
        );
      }
      if (!upload.confirmed_at) await markConfirmed(tx, upload.id);
      return upload.id;
    });
    await this.queue.process(queued);
    return loadProfile(
      this.dataSource.manager,
      auth.userId,
      this.photosBaseUrl,
    );
  }

  /** Back to the silhouette; also drops a waiting upload. Others are told. */
  async remove(auth: AuthUser, correlationId: string): Promise<UserProfile> {
    const profile = await this.dataSource.transaction(async (tx) => {
      await this.lockUser(tx, auth);
      if (await removeUserPhotos(tx, auth.userId)) {
        await announceProfile(
          tx,
          auth.userId,
          this.photosBaseUrl,
          correlationId,
        );
      }
      return loadProfile(tx, auth.userId, this.photosBaseUrl);
    });
    await this.queue.cleanup();
    return profile;
  }

  /** The caller's live account, locked; the session must still be live. */
  private async lockUser(tx: EntityManager, auth: AuthUser): Promise<void> {
    await assertLiveSession(tx, auth);
    if (!(await lockLiveUser(tx, auth.userId))) throw UNAUTHENTICATED();
  }
}
