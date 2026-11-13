import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  PHOTO_MAX_BYTES,
  PROFILE_PHOTO_VARIANTS,
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
import type { IdentityConfig } from '../config';
import { profilePhotoObjectKey, type FileKind } from './photos.repository';

/** Presigned upload URLs live this long (ADR-0009). */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * The two buckets (ADR-0009), through Identity's own key: raw uploads
 * (private, `incoming/`) and processed photos (public, `profiles/`).
 */
@Injectable()
export class PhotoStorage implements OnApplicationShutdown {
  private readonly client: S3Client;
  private readonly uploadsBucket: string;
  private readonly publicBucket: string;

  constructor(config: ConfigService<IdentityConfig, true>) {
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
    for (const [name, edge] of Object.entries(PROFILE_PHOTO_VARIANTS)) {
      await writeObject(this.client, {
        bucket: this.publicBucket,
        key: profilePhotoObjectKey(publicKey, edge),
        body: sizes[name],
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      });
    }
  }

  /** Deletes what a `photo_file_deletions` entry lists; missing files are fine. */
  async deleteFiles(kind: FileKind, key: string): Promise<void> {
    if (kind === 'UPLOAD') {
      await deleteObjects(this.client, this.uploadsBucket, [key]);
      return;
    }
    await deleteObjects(
      this.client,
      this.publicBucket,
      Object.values(PROFILE_PHOTO_VARIANTS).map((edge) =>
        profilePhotoObjectKey(key, edge),
      ),
    );
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
