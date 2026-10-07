import {
  CreateBucketCommand,
  DeleteBucketCommand,
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { startS3, type S3Credentials, type TestS3 } from './s3';

/** The storage rules ADR-0009 relies on, against the real infra scripts. */
describe('startS3 (SeaweedFS + infra/storage scripts)', () => {
  let s3: TestS3;
  let admin: S3Client;
  let catalog: S3Client;

  const client = (credentials: S3Credentials) =>
    new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      forcePathStyle: true,
      credentials,
      // Otherwise the SDK signs a checksum of an empty body into presigned
      // URLs, and every real upload fails with BadDigest.
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });

  beforeAll(async () => {
    s3 = await startS3();
    admin = client(s3.admin);
    catalog = client(s3.catalog);
  });

  afterAll(async () => {
    admin?.destroy();
    catalog?.destroy();
    await s3?.stop();
  });

  /** A presigned upload URL as Catalog will issue it (step 10). */
  const uploadUrl = (key: string, contentType = 'image/jpeg') =>
    getSignedUrl(
      catalog,
      new PutObjectCommand({
        Bucket: s3.uploadsBucket,
        Key: key,
        ContentType: contentType,
      }),
      // Signing Content-Type makes storage reject any other file type.
      { expiresIn: 300, signableHeaders: new Set(['content-type']) },
    );

  describe('browser uploads to the private bucket', () => {
    it('accepts a presigned PUT from our origin', async () => {
      const url = await uploadUrl('incoming/ok.jpg');
      const preflight = await fetch(url, {
        method: 'OPTIONS',
        headers: {
          Origin: s3.corsOrigin,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      expect(preflight.status).toBe(200);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(
        s3.corsOrigin,
      );

      const put = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg', Origin: s3.corsOrigin },
        body: 'not really a jpeg',
      });
      expect(put.status).toBe(200);
      const stored = await admin.send(
        new GetObjectCommand({
          Bucket: s3.uploadsBucket,
          Key: 'incoming/ok.jpg',
        }),
      );
      expect(await stored.Body?.transformToString()).toBe('not really a jpeg');
    });

    it('refuses other origins', async () => {
      const preflight = await fetch(await uploadUrl('incoming/x.jpg'), {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.example',
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      expect(preflight.status).toBe(403);
      expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('refuses a different content type than the one signed', async () => {
      const put = await fetch(await uploadUrl('incoming/evil.jpg'), {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: '<script>alert(1)</script>',
      });
      expect(put.status).toBe(403);
    });

    it('expires raw uploads after a day (safety net behind the sweeper)', async () => {
      const lifecycle = await admin.send(
        new GetBucketLifecycleConfigurationCommand({
          Bucket: s3.uploadsBucket,
        }),
      );
      expect(lifecycle.Rules).toEqual([
        expect.objectContaining({
          ID: 'expire-incoming',
          Status: 'Enabled',
          Filter: { Prefix: 'incoming/' },
          Expiration: expect.objectContaining({ Days: 1 }),
        }),
      ]);
    });
  });

  describe('anonymous access', () => {
    beforeAll(async () => {
      await catalog.send(
        new PutObjectCommand({
          Bucket: s3.publicBucket,
          Key: 'items/photo.webp',
          Body: 'public photo',
          ContentType: 'image/webp',
        }),
      );
      await catalog.send(
        new PutObjectCommand({
          Bucket: s3.uploadsBucket,
          Key: 'incoming/raw.jpg',
          Body: 'raw photo with GPS',
          ContentType: 'image/jpeg',
        }),
      );
    });

    it('can read the public bucket, nothing else', async () => {
      const pub = await fetch(s3.publicUrl('items/photo.webp'));
      expect(pub.status).toBe(200);
      expect(await pub.text()).toBe('public photo');

      const raw = await fetch(
        `${s3.endpoint}/${s3.uploadsBucket}/incoming/raw.jpg`,
      );
      expect(raw.status).toBe(403);
    });

    it('can neither list nor write any bucket', async () => {
      for (const bucket of [s3.publicBucket, s3.uploadsBucket]) {
        const list = await fetch(`${s3.endpoint}/${bucket}?list-type=2`);
        expect(list.status).toBe(403);
        const put = await fetch(`${s3.endpoint}/${bucket}/items/new.webp`, {
          method: 'PUT',
          body: 'x',
        });
        expect(put.status).toBe(403);
      }
    });
  });

  describe("Catalog's key", () => {
    it('cannot create or delete buckets', async () => {
      await expect(
        catalog.send(new CreateBucketCommand({ Bucket: 'not-ours' })),
      ).rejects.toMatchObject({ name: 'AccessDenied' });
      await expect(
        catalog.send(new DeleteBucketCommand({ Bucket: s3.publicBucket })),
      ).rejects.toMatchObject({ name: 'AccessDenied' });
    });
  });
});
