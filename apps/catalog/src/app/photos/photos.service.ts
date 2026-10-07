import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '@borrowbox/auth';
import {
  ITEM_PHOTOS_MAX,
  type PhotoUpload,
  type PhotoView,
} from '@borrowbox/contracts';
import type { CatalogConfig } from '../config';
import { DATA_SOURCE } from '../database/database.module';
import {
  lockOwnItem,
  toPhotoView,
  type ItemRow,
} from '../items/items.repository';
import { isLenderDeleted } from '../lenders/lenders.repository';
import { CatalogError } from '../rpc/rpc-errors';
import { PhotoQueue } from './photo-queue';
import { PhotoStorage } from './photo-storage';
import type {
  CreatePhotoUploadDto,
  PhotoRefDto,
  ReorderPhotosDto,
} from './photos.dto';
import {
  countPhotos,
  insertPendingPhoto,
  listItemPhotos,
  lockPhoto,
  markConfirmed,
  removePhotos,
  setPositions,
} from './photos.repository';

const ITEM_NOT_FOUND = () => new CatalogError('NOT_FOUND', 'Item not found');
const PHOTO_NOT_FOUND = () => new CatalogError('NOT_FOUND', 'Photo not found');

/**
 * Photos of the caller's own items (ADR-0009, ADR-0013). Every command
 * locks the item's row first, then the photo's, like the item commands.
 */
@Injectable()
export class PhotosService {
  private readonly photosBaseUrl: string;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly storage: PhotoStorage,
    private readonly queue: PhotoQueue,
    config: ConfigService<CatalogConfig, true>,
  ) {
    this.photosBaseUrl = config.get('PHOTOS_BASE_URL', { infer: true });
  }

  /**
   * A PENDING photo at the end of the item, and a presigned URL for the
   * browser to upload it to. Failed photos count until removed (P2).
   */
  async createUpload(
    user: AuthUser,
    dto: CreatePhotoUploadDto,
  ): Promise<PhotoUpload> {
    const photo = await this.dataSource.transaction(async (tx) => {
      await this.lockItem(tx, user, dto.itemId);
      if ((await countPhotos(tx, dto.itemId)) >= ITEM_PHOTOS_MAX) {
        throw new CatalogError(
          'PHOTO_LIMIT_REACHED',
          `An item can have up to ${ITEM_PHOTOS_MAX} photos`,
        );
      }
      return insertPendingPhoto(tx, {
        itemId: dto.itemId,
        uploadKey: `incoming/${randomUUID()}`,
        contentType: dto.contentType,
        sizeBytes: dto.sizeBytes,
      });
    });
    // After the commit: a row exists for every URL ever issued, so the
    // sweeper can always find and remove an abandoned upload.
    const upload = await this.storage.presignUpload(
      photo.upload_key,
      dto.contentType,
    );
    return {
      photoId: photo.id,
      uploadUrl: upload.url,
      uploadHeaders: upload.headers,
      expiresAt: upload.expiresAt.toISOString(),
    };
  }

  /**
   * The browser's upload has finished: queue processing. Repeating it is
   * safe; confirming before the file arrived is refused (P1).
   */
  async confirm(user: AuthUser, dto: PhotoRefDto): Promise<PhotoView> {
    const { photo, queued } = await this.dataSource.transaction(async (tx) => {
      await this.lockItem(tx, user, dto.itemId);
      const photo = await lockPhoto(tx, dto.itemId, dto.photoId);
      if (!photo) throw PHOTO_NOT_FOUND();
      if (photo.status !== 'PENDING') return { photo, queued: false };
      if ((await this.storage.uploadSize(photo.upload_key)) === null) {
        throw new CatalogError(
          'INVALID_STATE',
          "The photo hasn't been uploaded yet",
        );
      }
      if (!photo.confirmed_at) await markConfirmed(tx, photo.id);
      return { photo, queued: true };
    });
    if (queued) await this.queue.process(photo.id);
    return toPhotoView(photo, this.photosBaseUrl);
  }

  /**
   * Removes the photo and lists its files for deletion (P5). An active
   * item's last processed photo can't be removed (P4).
   */
  async delete(user: AuthUser, dto: PhotoRefDto): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const item = await this.lockItem(tx, user, dto.itemId);
      const photo = await lockPhoto(tx, dto.itemId, dto.photoId);
      if (!photo) throw PHOTO_NOT_FOUND();
      if (
        item.status === 'ACTIVE' &&
        photo.status === 'READY' &&
        (await countPhotos(tx, dto.itemId, 'READY')) === 1
      ) {
        throw new CatalogError(
          'INVALID_STATE',
          'An active item needs a photo: add another or pause it first',
        );
      }
      await removePhotos(tx, { photoId: photo.id });
    });
    await this.queue.cleanup();
  }

  /** `photoIds` must be exactly the item's photos, in the new order. */
  async reorder(user: AuthUser, dto: ReorderPhotosDto): Promise<PhotoView[]> {
    return this.dataSource.transaction(async (tx) => {
      await this.lockItem(tx, user, dto.itemId);
      const current = (await listItemPhotos(tx, dto.itemId)).map((p) => p.id);
      const sameSet =
        current.length === dto.photoIds.length &&
        dto.photoIds.every((id) => current.includes(id));
      if (!sameSet) {
        throw new CatalogError('VALIDATION_FAILED', 'Invalid fields: photoIds');
      }
      await setPositions(tx, dto.itemId, dto.photoIds);
      return (await listItemPhotos(tx, dto.itemId)).map((p) =>
        toPhotoView(p, this.photosBaseUrl),
      );
    });
  }

  /** The caller's live item, locked; refuses accounts already deleted. */
  private async lockItem(
    tx: EntityManager,
    user: AuthUser,
    itemId: string,
  ): Promise<ItemRow> {
    if (await isLenderDeleted(tx, user.userId)) {
      throw new CatalogError('UNAUTHENTICATED', 'Authentication required');
    }
    const item = await lockOwnItem(tx, itemId, user.userId);
    if (!item || item.status === 'DELETED') throw ITEM_NOT_FOUND();
    return item;
  }
}
