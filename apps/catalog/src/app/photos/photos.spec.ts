import { randomUUID } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import {
  CatalogRpc,
  createEnvelope,
  ITEM_PHOTOS_MAX,
  PHOTO_VARIANTS,
  UserDeletionRequestedV1,
  type CatalogRpcPattern,
  type OwnItem,
  type PhotoView,
  type RpcErrorBody,
} from '@borrowbox/contracts';
import { createStorageClient, objectSize, writeObject } from '@borrowbox/media';
import {
  startPostgres,
  startRabbitMq,
  startRedis,
  startS3,
  type TestPostgres,
  type TestRabbitMq,
  type TestRedis,
  type TestS3,
} from '@borrowbox/testing';
import {
  startCatalog,
  type CatalogHarness,
} from '../../testing/catalog-harness';
import { publicPhotoObjectKey } from '../items/items.repository';
import { UserEventsConsumer } from '../lenders/user-events.consumer';
import { PhotoMaintenance } from './photo-maintenance';
import { PhotoProcessor } from './photo-processor';
import { PhotoStorage } from './photo-storage';

/**
 * The photo pipeline end to end (ADR-0009, ADR-0013): presigned upload,
 * confirm, the real BullMQ worker, storage, cleanup and the sweeper, with
 * Postgres, RabbitMQ, Redis and SeaweedFS all real.
 */
describe('Photo pipeline (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let redis: TestRedis;
  let s3: TestS3;
  let catalog: CatalogHarness;
  /** Full rights, for assertions only. */
  let admin: S3Client;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    [pg, rabbit, redis, s3] = await Promise.all([
      startPostgres(),
      startRabbitMq(),
      startRedis(),
      startS3(),
    ]);
    catalog = await startCatalog({
      databaseUrl: pg.urlFor('catalog'),
      rabbitmqUrl: rabbit.url,
      redisUrl: redis.url,
      s3,
    });
    admin = createStorageClient({
      endpoint: s3.endpoint,
      region: s3.region,
      ...s3.admin,
    });
  });

  afterAll(async () => {
    admin?.destroy();
    await catalog?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop(), redis?.stop(), s3?.stop()]);
  });

  // --- helpers ----------------------------------------------------------------

  const ATHENS = { lat: 37.9838, lng: 23.7275 };

  async function as<P extends CatalogRpcPattern>(
    userId: string,
    pattern: P,
    data: unknown,
  ) {
    return catalog.send(pattern, data, {
      accessToken: await catalog.tokenFor(userId),
    });
  }

  async function failure(promise: Promise<unknown>): Promise<RpcErrorBody> {
    try {
      await promise;
    } catch (err) {
      return err as RpcErrorBody;
    }
    throw new Error('expected the call to fail');
  }

  async function newItem(userId: string): Promise<OwnItem> {
    return as(userId, CatalogRpc.create, {
      itemId: randomUUID(),
      title: 'Cordless drill',
      category: 'tools',
      pricing: { free: true },
      depositCents: 0,
    });
  }

  function photo(width = 1200, height = 800) {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 30, g: 90, b: 160 },
      },
    });
  }

  /** A JPEG carrying GPS and camera details, like a phone photo. */
  function phonePhoto(): Promise<Buffer> {
    return photo()
      .jpeg()
      .withExif({
        IFD0: { Make: 'TestCam', Model: 'Secret-Phone-9' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '37/1 58/1 51/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '23/1 43/1 39/1',
        },
      })
      .toBuffer();
  }

  /** Asks for an upload URL and uploads to it, as the browser does. */
  async function upload(
    userId: string,
    itemId: string,
    body: Buffer,
    contentType = 'image/jpeg',
  ): Promise<string> {
    const target = await as(userId, CatalogRpc.createPhotoUpload, {
      itemId,
      contentType,
      sizeBytes: body.length,
    });
    const response = await fetch(target.uploadUrl, {
      method: 'PUT',
      headers: target.uploadHeaders,
      body,
    });
    expect(response.status).toBe(200);
    return target.photoId;
  }

  async function waitFor<T>(
    check: () => Promise<T | undefined | null | false>,
    what: string,
  ): Promise<T> {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const value = await check();
      if (value) return value;
      if (Date.now() > deadline)
        throw new Error(`Timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async function photoOf(
    userId: string,
    itemId: string,
    photoId: string,
  ): Promise<PhotoView | undefined> {
    const item = await as(userId, CatalogRpc.getOwn, { itemId });
    return item.photos.find((p) => p.id === photoId);
  }

  /** Confirms and waits until the worker has finished with the photo. */
  async function confirmAndProcess(
    userId: string,
    itemId: string,
    photoId: string,
  ): Promise<PhotoView> {
    await as(userId, CatalogRpc.confirmPhoto, { itemId, photoId });
    return waitFor(async () => {
      const p = await photoOf(userId, itemId, photoId);
      return p && p.status !== 'PENDING' ? p : undefined;
    }, 'processing');
  }

  async function uploadKeyOf(photoId: string): Promise<string> {
    const [{ upload_key }] = await catalog.dataSource.query(
      `SELECT upload_key FROM item_photos WHERE id = $1`,
      [photoId],
    );
    return upload_key;
  }

  const publicKeyOf = (view: PhotoView): string =>
    /\/items\/([0-9a-f-]{36})\//.exec(view.urls?.small ?? '')?.[1] ?? '';

  const publicFilesExist = async (publicKey: string): Promise<boolean[]> =>
    Promise.all(
      Object.values(PHOTO_VARIANTS).map(
        async (w) =>
          (await objectSize(
            admin,
            s3.publicBucket,
            publicPhotoObjectKey(publicKey, w),
          )) !== null,
      ),
    );

  const uploadExists = async (key: string) =>
    (await objectSize(admin, s3.uploadsBucket, key)) !== null;

  const noPendingDeletions = async () => {
    const [{ count }] = await catalog.dataSource.query(
      `SELECT count(*)::int AS count FROM photo_file_deletions WHERE not_before <= now()`,
    );
    return count === 0;
  };

  // --- the happy path -----------------------------------------------------------

  it('turns a phone photo into public, metadata-free sizes and removes the original', async () => {
    const userId = randomUUID();
    const item = await newItem(userId);
    const photoId = await upload(userId, item.id, await phonePhoto());
    const uploadKey = await uploadKeyOf(photoId);

    const ready = await confirmAndProcess(userId, item.id, photoId);
    expect(ready).toMatchObject({ id: photoId, status: 'READY', position: 0 });

    for (const [name, url] of Object.entries(ready.urls ?? {})) {
      // Anyone can load it, without credentials.
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/webp');
      const bytes = Buffer.from(await response.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(bytes.includes('Secret-Phone-9')).toBe(false);
      expect(meta.width).toBe(
        Math.min(1200, PHOTO_VARIANTS[name as keyof typeof PHOTO_VARIANTS]),
      );
    }

    await waitFor(
      async () => !(await uploadExists(uploadKey)),
      'original removed',
    );
    await waitFor(noPendingDeletions, 'cleanup');
  });

  it.each([
    ['PNG', 'image/png', () => photo().png().toBuffer()],
    ['AVIF', 'image/avif', () => photo().avif().toBuffer()],
    ['GIF', 'image/gif', () => photo().gif().toBuffer()],
  ])('processes a %s photo', async (_, type, make) => {
    const userId = randomUUID();
    const item = await newItem(userId);
    const photoId = await upload(userId, item.id, await make(), type);
    expect((await confirmAndProcess(userId, item.id, photoId)).status).toBe(
      'READY',
    );
  });

  // --- confirm ----------------------------------------------------------------------

  it('refuses to confirm before the upload has arrived, and confirming twice is fine', async () => {
    const userId = randomUUID();
    const item = await newItem(userId);
    const target = await as(userId, CatalogRpc.createPhotoUpload, {
      itemId: item.id,
      contentType: 'image/jpeg',
      sizeBytes: 1000,
    });
    expect(
      await failure(
        as(userId, CatalogRpc.confirmPhoto, {
          itemId: item.id,
          photoId: target.photoId,
        }),
      ),
    ).toEqual({
      code: 'INVALID_STATE',
      message: "The photo hasn't been uploaded yet",
    });

    await fetch(target.uploadUrl, {
      method: 'PUT',
      headers: target.uploadHeaders,
      body: await phonePhoto(),
    });
    await as(userId, CatalogRpc.confirmPhoto, {
      itemId: item.id,
      photoId: target.photoId,
    });
    await as(userId, CatalogRpc.confirmPhoto, {
      itemId: item.id,
      photoId: target.photoId,
    });
    await waitFor(
      async () =>
        (await photoOf(userId, item.id, target.photoId))?.status === 'READY',
      'ready',
    );
    // Confirming a READY photo again just returns it.
    const again = await as(userId, CatalogRpc.confirmPhoto, {
      itemId: item.id,
      photoId: target.photoId,
    });
    expect(again.status).toBe('READY');
  });

  // --- rejected photos (P2, P3) --------------------------------------------------

  it.each([
    [
      'a text file sent as a JPEG',
      async () => Buffer.from('not an image at all'),
    ],
    ['a photo narrower than 320 px', () => photo(300, 600).jpeg().toBuffer()],
  ])(
    'marks %s FAILED, keeps it visible and removes the original',
    async (_, make) => {
      const userId = randomUUID();
      const item = await newItem(userId);
      const photoId = await upload(userId, item.id, await make());
      const uploadKey = await uploadKeyOf(photoId);
      const failed = await confirmAndProcess(userId, item.id, photoId);
      expect(failed).toEqual({
        id: photoId,
        status: 'FAILED',
        position: 0,
        urls: null,
      });
      await waitFor(
        async () => !(await uploadExists(uploadKey)),
        'original removed',
      );

      // The owner removes it to try again.
      await as(userId, CatalogRpc.deletePhoto, { itemId: item.id, photoId });
      expect(
        (await as(userId, CatalogRpc.getOwn, { itemId: item.id })).photos,
      ).toEqual([]);
    },
  );

  // --- the limit ------------------------------------------------------------------

  it(`allows ${ITEM_PHOTOS_MAX} photos per item, also when asked for in parallel`, async () => {
    const userId = randomUUID();
    const item = await newItem(userId);
    const results = await Promise.allSettled(
      Array.from({ length: ITEM_PHOTOS_MAX + 2 }, () =>
        as(userId, CatalogRpc.createPhotoUpload, {
          itemId: item.id,
          contentType: 'image/jpeg',
          sizeBytes: 1000,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(
      ITEM_PHOTOS_MAX,
    );
    const refused = results.filter((r) => r.status === 'rejected');
    expect(refused).toHaveLength(2);
    expect((refused[0] as PromiseRejectedResult).reason).toEqual({
      code: 'PHOTO_LIMIT_REACHED',
      message: `An item can have up to ${ITEM_PHOTOS_MAX} photos`,
    });
    const positions = (
      await as(userId, CatalogRpc.getOwn, { itemId: item.id })
    ).photos.map((p) => p.position);
    expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it.each([
    ['an SVG', { contentType: 'image/svg+xml', sizeBytes: 1000 }],
    [
      'HEIC (the PWA converts it)',
      { contentType: 'image/heic', sizeBytes: 1000 },
    ],
    ['an empty file', { contentType: 'image/jpeg', sizeBytes: 0 }],
    [
      'a file over 10 MB',
      { contentType: 'image/jpeg', sizeBytes: 10 * 1024 * 1024 + 1 },
    ],
  ])('refuses to issue an upload URL for %s', async (_, request) => {
    const userId = randomUUID();
    const item = await newItem(userId);
    expect(
      (
        await failure(
          as(userId, CatalogRpc.createPhotoUpload, {
            itemId: item.id,
            ...request,
          }),
        )
      ).code,
    ).toBe('VALIDATION_FAILED');
  });

  // --- reorder and delete --------------------------------------------------------------

  it('reorders photos, and only with exactly the item’s photos', async () => {
    const userId = randomUUID();
    const item = await newItem(userId);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        (
          await as(userId, CatalogRpc.createPhotoUpload, {
            itemId: item.id,
            contentType: 'image/jpeg',
            sizeBytes: 1000,
          })
        ).photoId,
      );
    }
    const reordered = await as(userId, CatalogRpc.reorderPhotos, {
      itemId: item.id,
      photoIds: [ids[2], ids[0], ids[1]],
    });
    expect(reordered.map((p) => [p.id, p.position])).toEqual([
      [ids[2], 0],
      [ids[0], 1],
      [ids[1], 2],
    ]);
    for (const photoIds of [
      [ids[0], ids[1]],
      [...ids, randomUUID()],
      [ids[0], ids[0], ids[1]],
    ]) {
      expect(
        (
          await failure(
            as(userId, CatalogRpc.reorderPhotos, { itemId: item.id, photoIds }),
          )
        ).code,
      ).toBe('VALIDATION_FAILED');
    }
  });

  it('deletes a photo with its files and closes up the positions', async () => {
    const userId = randomUUID();
    const item = await newItem(userId);
    const first = await upload(userId, item.id, await phonePhoto());
    const second = await upload(userId, item.id, await phonePhoto());
    const ready = await confirmAndProcess(userId, item.id, first);
    await confirmAndProcess(userId, item.id, second);
    const publicKey = publicKeyOf(ready);
    expect(await publicFilesExist(publicKey)).toEqual([true, true, true]);

    await as(userId, CatalogRpc.deletePhoto, {
      itemId: item.id,
      photoId: first,
    });
    const left = (await as(userId, CatalogRpc.getOwn, { itemId: item.id }))
      .photos;
    expect(left.map((p) => [p.id, p.position])).toEqual([[second, 0]]);
    await waitFor(
      async () => (await publicFilesExist(publicKey)).every((e) => !e),
      'public files deleted',
    );
  });

  it("refuses to delete an active item's last processed photo (P4)", async () => {
    const userId = randomUUID();
    const item = await newItem(userId);
    await as(userId, CatalogRpc.setLocation, {
      itemId: item.id,
      location: ATHENS,
    });
    const only = await upload(userId, item.id, await phonePhoto());
    await confirmAndProcess(userId, item.id, only);
    await as(userId, CatalogRpc.publish, { itemId: item.id });

    expect(
      await failure(
        as(userId, CatalogRpc.deletePhoto, { itemId: item.id, photoId: only }),
      ),
    ).toEqual({
      code: 'INVALID_STATE',
      message: 'An active item needs a photo: add another or pause it first',
    });
    await as(userId, CatalogRpc.pause, { itemId: item.id });
    await as(userId, CatalogRpc.deletePhoto, {
      itemId: item.id,
      photoId: only,
    });
    expect(
      (await failure(as(userId, CatalogRpc.unpause, { itemId: item.id }))).code,
    ).toBe('NOT_PUBLISHABLE');
  });

  // --- items and accounts going away -------------------------------------------------

  it('removes the photos and files of a deleted item', async () => {
    const userId = randomUUID();
    const item = await newItem(userId);
    const photoId = await upload(userId, item.id, await phonePhoto());
    const publicKey = publicKeyOf(
      await confirmAndProcess(userId, item.id, photoId),
    );

    await as(userId, CatalogRpc.delete, { itemId: item.id });
    const [{ count }] = await catalog.dataSource.query(
      `SELECT count(*)::int AS count FROM item_photos WHERE item_id = $1`,
      [item.id],
    );
    expect(count).toBe(0);
    await waitFor(
      async () => (await publicFilesExist(publicKey)).every((e) => !e),
      'files deleted',
    );
  });

  it('removes every photo file of a deleted account (GDPR)', async () => {
    const userId = randomUUID();
    const item = await newItem(userId);
    const processed = await upload(userId, item.id, await phonePhoto());
    const publicKey = publicKeyOf(
      await confirmAndProcess(userId, item.id, processed),
    );
    // And one still waiting for its upload to be confirmed.
    const waiting = await upload(userId, item.id, await phonePhoto());
    const waitingKey = await uploadKeyOf(waiting);

    await catalog.app
      .get(UserEventsConsumer)
      .handle(
        createEnvelope(UserDeletionRequestedV1, { userId }),
        UserDeletionRequestedV1.routingKey,
      );
    await waitFor(
      async () =>
        (await publicFilesExist(publicKey)).every((e) => !e) &&
        !(await uploadExists(waitingKey)),
      'all files deleted',
    );
  });

  // --- recovery ---------------------------------------------------------------------------

  it('re-queues a confirmed photo whose processing was interrupted', async () => {
    const userId = randomUUID();
    const item = await newItem(userId);
    const photoId = await upload(userId, item.id, await phonePhoto());
    // Confirmed 10 minutes ago, but its job was lost.
    await catalog.dataSource.query(
      `UPDATE item_photos SET confirmed_at = now() - interval '10 minutes' WHERE id = $1`,
      [photoId],
    );
    expect(await catalog.app.get(PhotoMaintenance).sweep()).toMatchObject({
      requeued: 1,
    });
    await waitFor(
      async () => (await photoOf(userId, item.id, photoId))?.status === 'READY',
      'ready',
    );
  });

  it('removes uploads abandoned for a day, row and file', async () => {
    const userId = randomUUID();
    const item = await newItem(userId);
    const photoId = await upload(userId, item.id, await phonePhoto());
    const key = await uploadKeyOf(photoId);
    await catalog.dataSource.query(
      `UPDATE item_photos SET created_at = now() - interval '25 hours' WHERE id = $1`,
      [photoId],
    );
    expect(await catalog.app.get(PhotoMaintenance).sweep()).toMatchObject({
      abandoned: 1,
    });
    expect(await photoOf(userId, item.id, photoId)).toBeUndefined();
    await waitFor(async () => !(await uploadExists(key)), 'upload deleted');
  });

  it('never deletes files before their time', async () => {
    const key = `items/${randomUUID()}`;
    const files = Object.values(PHOTO_VARIANTS).map((w) =>
      publicPhotoObjectKey(key.replace('items/', ''), w),
    );
    for (const file of files) {
      await writeObject(admin, {
        bucket: s3.publicBucket,
        key: file,
        body: Buffer.from('x'),
        contentType: 'image/webp',
      });
    }
    const publicKey = key.replace('items/', '');
    await catalog.dataSource.query(
      `INSERT INTO photo_file_deletions (kind, key, not_before)
       VALUES ('PUBLIC_PHOTO', $1, now() + interval '1 hour')`,
      [publicKey],
    );
    await catalog.app.get(PhotoMaintenance).cleanup();
    expect(await publicFilesExist(publicKey)).toEqual([true, true, true]);

    await catalog.dataSource.query(
      `UPDATE photo_file_deletions SET not_before = now() WHERE key = $1`,
      [publicKey],
    );
    await catalog.app.get(PhotoMaintenance).cleanup();
    expect(await publicFilesExist(publicKey)).toEqual([false, false, false]);
  });

  it('cleans up the new files when a photo is deleted while being processed', async () => {
    const userId = randomUUID();
    const item = await newItem(userId);
    const photoId = await upload(userId, item.id, await phonePhoto());
    await catalog.dataSource.query(
      `UPDATE item_photos SET confirmed_at = now() WHERE id = $1`,
      [photoId],
    );
    // The owner deletes it right after the worker has written the files.
    const storage = catalog.app.get(PhotoStorage);
    const write = storage.writePublicSizes.bind(storage);
    let written = '';
    const spy = jest
      .spyOn(storage, 'writePublicSizes')
      .mockImplementation(async (publicKey, sizes) => {
        await write(publicKey, sizes);
        written = publicKey;
        await as(userId, CatalogRpc.deletePhoto, { itemId: item.id, photoId });
      });
    try {
      await catalog.app.get(PhotoProcessor).process(photoId);
    } finally {
      spy.mockRestore();
    }
    expect(written).not.toBe('');
    await waitFor(
      async () => (await publicFilesExist(written)).every((e) => !e),
      'orphan files deleted',
    );
  });

  // --- access -------------------------------------------------------------------------------

  it("never touches someone else's photos, and needs a token", async () => {
    const owner = randomUUID();
    const item = await newItem(owner);
    const target = await as(owner, CatalogRpc.createPhotoUpload, {
      itemId: item.id,
      contentType: 'image/jpeg',
      sizeBytes: 1000,
    });
    const other = randomUUID();
    const ref = { itemId: item.id, photoId: target.photoId };
    for (const [pattern, data] of [
      [
        CatalogRpc.createPhotoUpload,
        { itemId: item.id, contentType: 'image/jpeg', sizeBytes: 1 },
      ],
      [CatalogRpc.confirmPhoto, ref],
      [CatalogRpc.deletePhoto, ref],
      [
        CatalogRpc.reorderPhotos,
        { itemId: item.id, photoIds: [target.photoId] },
      ],
    ] as const) {
      expect(await failure(as(other, pattern, data))).toEqual({
        code: 'NOT_FOUND',
        message: 'Item not found',
      });
      expect((await failure(catalog.send(pattern, data))).code).toBe(
        'UNAUTHENTICATED',
      );
    }
    expect(
      (await as(owner, CatalogRpc.getOwn, { itemId: item.id })).photos,
    ).toHaveLength(1);
  });
});
