import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  CONDITION_PHOTO_URL_TTL_SECONDS,
  CONDITION_PHOTO_VARIANTS,
  PHOTO_MAX_BYTES,
  type ConditionPhotoUrls,
  type PhotoContentType,
} from '@borrowbox/contracts';
import {
  createStorageClient,
  deleteObjects,
  objectSize,
  presignDownload,
  presignUpload,
  readObject,
  writeObject,
  type PresignedUpload,
} from '@borrowbox/media';
import type { BookingsConfig } from '../config';
import {
  evidenceObjectKey,
  evidenceObjectKeys,
  type FileKind,
} from './photos.repository';

/** Presigned upload URLs live this long (ADR-0009). */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * Bookings' two buckets (ADR-0027), through its own key: raw uploads
 * (private, `incoming/`) and processed condition photos (private evidence
 * bucket, `conditions/`). Nothing here is ever public: photos are read
 * through presigned links that expire after 5 minutes.
 */
@Injectable()
export class PhotoStorage implements OnApplicationShutdown {
  private readonly client: S3Client;
  private readonly uploadsBucket: string;
  private readonly evidenceBucket: string;

  constructor(config: ConfigService<BookingsConfig, true>) {
    this.client = createStorageClient({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
      secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
    });
    this.uploadsBucket = config.get('S3_UPLOADS_BUCKET', { infer: true });
    this.evidenceBucket = config.get('S3_EVIDENCE_BUCKET', { infer: true });
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

  /** Keys are random and never reused; private, so no public caching. */
  async writeEvidence(
    fileKey: string,
    sizes: Record<string, Buffer>,
  ): Promise<void> {
    for (const [name, width] of Object.entries(CONDITION_PHOTO_VARIANTS)) {
      await writeObject(this.client, {
        bucket: this.evidenceBucket,
        key: evidenceObjectKey(fileKey, width),
        body: sizes[name],
        contentType: 'image/webp',
        cacheControl: 'private, max-age=300',
      });
    }
  }

  /** Links to a processed photo's sizes, valid 5 minutes. */
  async links(
    fileKey: string,
    now = new Date(),
  ): Promise<{ urls: ConditionPhotoUrls; expiresAt: Date }> {
    const entries = await Promise.all(
      Object.entries(CONDITION_PHOTO_VARIANTS).map(async ([name, width]) => {
        const link = await presignDownload(
          this.client,
          {
            bucket: this.evidenceBucket,
            key: evidenceObjectKey(fileKey, width),
            expiresInSeconds: CONDITION_PHOTO_URL_TTL_SECONDS,
          },
          now,
        );
        return [name, link.url] as const;
      }),
    );
    return {
      urls: Object.fromEntries(entries) as ConditionPhotoUrls,
      expiresAt: new Date(
        now.getTime() + CONDITION_PHOTO_URL_TTL_SECONDS * 1000,
      ),
    };
  }

  /** Deletes what a `photo_file_deletions` entry lists; missing files are fine. */
  async deleteFiles(kind: FileKind, key: string): Promise<void> {
    if (kind === 'UPLOAD') {
      await deleteObjects(this.client, this.uploadsBucket, [key]);
      return;
    }
    await deleteObjects(
      this.client,
      this.evidenceBucket,
      evidenceObjectKeys(key),
    );
  }

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
