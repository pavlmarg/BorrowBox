import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  PHOTO_MAX_BYTES,
  PHOTO_VARIANTS,
  type PhotoContentType,
} from '@borrowbox/contracts';
import {
  createStorageClient,
  deleteObjects,
  objectSize,
  presignUpload,
  readObject,
  writeObject,
  type PresignedUpload,
} from '@borrowbox/media';
import type { CatalogConfig } from '../config';
import { publicPhotoObjectKey } from '../items/items.repository';

/** Presigned upload URLs live this long (ADR-0009). */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

/** Catalog's two buckets (ADR-0009): raw uploads (private), processed photos (public). */
@Injectable()
export class PhotoStorage implements OnApplicationShutdown {
  private readonly client: S3Client;
  private readonly uploadsBucket: string;
  private readonly publicBucket: string;

  constructor(config: ConfigService<CatalogConfig, true>) {
    this.client = createStorageClient({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
      secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
    });
    this.uploadsBucket = config.get('S3_UPLOADS_BUCKET', { infer: true });
    this.publicBucket = config.get('S3_PUBLIC_BUCKET', { infer: true });
  }

  presignUpload(
    uploadKey: string,
    contentType: PhotoContentType,
  ): Promise<PresignedUpload> {
    return presignUpload(this.client, {
      bucket: this.uploadsBucket,
      key: uploadKey,
      contentType,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });
  }

  /** Null until the browser's upload has arrived. */
  uploadSize(uploadKey: string): Promise<number | null> {
    return objectSize(this.client, this.uploadsBucket, uploadKey);
  }

  /** Null if missing; throws ObjectTooLargeError over the photo size limit. */
  readUpload(uploadKey: string): Promise<Buffer | null> {
    return readObject(
      this.client,
      this.uploadsBucket,
      uploadKey,
      PHOTO_MAX_BYTES,
    );
  }

  /** Keys are random and never reused, so the files can be cached forever. */
  async writePublicSizes(
    publicKey: string,
    sizes: Record<string, Buffer>,
  ): Promise<void> {
    for (const [name, width] of Object.entries(PHOTO_VARIANTS)) {
      await writeObject(this.client, {
        bucket: this.publicBucket,
        key: publicPhotoObjectKey(publicKey, width),
        body: sizes[name],
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      });
    }
  }

  /** Deletes what a `photo_file_deletions` entry lists; missing files are fine. */
  async deleteFiles(
    kind: 'UPLOAD' | 'PUBLIC_PHOTO',
    key: string,
  ): Promise<void> {
    if (kind === 'UPLOAD') {
      await deleteObjects(this.client, this.uploadsBucket, [key]);
      return;
    }
    await deleteObjects(
      this.client,
      this.publicBucket,
      Object.values(PHOTO_VARIANTS).map((w) => publicPhotoObjectKey(key, w)),
    );
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
