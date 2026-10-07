import { randomUUID } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import { startS3, type TestS3 } from '@borrowbox/testing';
import {
  createStorageClient,
  deleteObjects,
  ObjectTooLargeError,
  objectSize,
  presignUpload,
  readObject,
  writeObject,
} from './storage';

/** Against SeaweedFS set up exactly like `docker compose` (ADR-0009). */
describe('storage (integration)', () => {
  let s3: TestS3;
  let client: S3Client;

  beforeAll(async () => {
    s3 = await startS3();
    // Catalog's scoped key, as in dev and production.
    client = createStorageClient({
      endpoint: s3.endpoint,
      region: s3.region,
      ...s3.catalog,
    });
  });

  afterAll(async () => {
    client?.destroy();
    await s3?.stop();
  });

  const incoming = () => `incoming/${randomUUID()}`;

  describe('presigned uploads', () => {
    it('accept the signed type, sent the way a browser would', async () => {
      const key = incoming();
      const upload = await presignUpload(client, {
        bucket: s3.uploadsBucket,
        key,
        contentType: 'image/jpeg',
        expiresInSeconds: 300,
      });
      expect(upload.headers).toEqual({ 'Content-Type': 'image/jpeg' });
      expect(upload.expiresAt.getTime()).toBeGreaterThan(Date.now() + 290_000);

      const response = await fetch(upload.url, {
        method: 'PUT',
        headers: { ...upload.headers, Origin: s3.corsOrigin },
        body: Buffer.from('fake jpeg bytes'),
      });
      expect(response.status).toBe(200);
      expect(await objectSize(client, s3.uploadsBucket, key)).toBe(15);
    });

    it('refuse any other content type', async () => {
      const key = incoming();
      const upload = await presignUpload(client, {
        bucket: s3.uploadsBucket,
        key,
        contentType: 'image/jpeg',
        expiresInSeconds: 300,
      });
      const response = await fetch(upload.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/svg+xml' },
        body: Buffer.from('<svg/>'),
      });
      expect(response.status).toBe(403);
      expect(await objectSize(client, s3.uploadsBucket, key)).toBeNull();
    });

    it('expire', async () => {
      const key = incoming();
      const upload = await presignUpload(
        client,
        {
          bucket: s3.uploadsBucket,
          key,
          contentType: 'image/png',
          expiresInSeconds: 60,
        },
        new Date(Date.now() - 120_000),
      );
      const response = await fetch(upload.url, {
        method: 'PUT',
        headers: upload.headers,
        body: Buffer.from('late'),
      });
      expect(response.status).toBe(403);
    });
  });

  describe('objects', () => {
    it('reads within a size limit, and refuses more', async () => {
      const key = incoming();
      const body = Buffer.alloc(5_000, 7);
      await writeObject(client, {
        bucket: s3.uploadsBucket,
        key,
        body,
        contentType: 'image/png',
      });
      expect(await readObject(client, s3.uploadsBucket, key, 5_000)).toEqual(
        body,
      );
      await expect(
        readObject(client, s3.uploadsBucket, key, 4_999),
      ).rejects.toBeInstanceOf(ObjectTooLargeError);
      expect(
        await readObject(client, s3.uploadsBucket, incoming(), 10),
      ).toBeNull();
    });

    it('serves the public bucket to anyone, but never the uploads bucket', async () => {
      const key = `items/${randomUUID()}/320.webp`;
      await writeObject(client, {
        bucket: s3.publicBucket,
        key,
        body: Buffer.from('webp'),
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      });
      const shown = await fetch(s3.publicUrl(key));
      expect(shown.status).toBe(200);
      expect(shown.headers.get('content-type')).toBe('image/webp');

      const raw = incoming();
      await writeObject(client, {
        bucket: s3.uploadsBucket,
        key: raw,
        body: Buffer.from('raw'),
        contentType: 'image/jpeg',
      });
      const hidden = await fetch(`${s3.endpoint}/${s3.uploadsBucket}/${raw}`);
      expect(hidden.status).toBe(403);
    });

    it('deletes, treating missing objects as deleted', async () => {
      const keys = [incoming(), incoming()];
      for (const key of keys) {
        await writeObject(client, {
          bucket: s3.uploadsBucket,
          key,
          body: Buffer.from('x'),
          contentType: 'image/jpeg',
        });
      }
      await deleteObjects(client, s3.uploadsBucket, [...keys, incoming()]);
      for (const key of keys) {
        expect(await objectSize(client, s3.uploadsBucket, key)).toBeNull();
      }
      await deleteObjects(client, s3.uploadsBucket, keys);
    });
  });
});
