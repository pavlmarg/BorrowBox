import { randomUUID } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import {
  BookingsRpc,
  CONDITION_PHOTOS_MAX_PER_PHASE,
  type BookingView,
  type BookingsDataExport,
  type ConditionPhotoView,
  type ConditionPhotosView,
  type RpcErrorBody,
} from '@borrowbox/contracts';
import { createStorageClient, objectSize } from '@borrowbox/media';
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
  startBookings,
  type BookingsHarness,
} from '../../testing/bookings-harness';
import { PhotoMaintenance } from './photo-maintenance';
import { evidenceObjectKeys } from './photos.repository';

const HOUR = 60 * 60 * 1000;
const at = (hours: number) =>
  new Date(Math.ceil(Date.now() / HOUR) * HOUR + hours * HOUR);

/**
 * Condition photos end to end (ADR-0027): presigned upload, confirm, the
 * real BullMQ worker, the private evidence bucket, links, the window and
 * limit, removal, retention, erasure and export, with Postgres, RabbitMQ,
 * Redis and SeaweedFS all real.
 */
describe('Condition photos (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let redis: TestRedis;
  let s3: TestS3;
  let bookings: BookingsHarness;
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
    bookings = await startBookings({
      databaseUrl: pg.urlFor('bookings'),
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
    await bookings?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop(), redis?.stop(), s3?.stop()]);
  });

  // --- helpers ----------------------------------------------------------------

  const as = async (userId: string) => ({
    accessToken: await bookings.tokenFor(userId),
  });

  async function failure(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (err) {
      return (err as RpcErrorBody).code;
    }
    throw new Error('expected the call to fail');
  }

  function picture(width = 1200, height = 800): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 200, g: 120, b: 40 },
      },
    })
      .jpeg()
      .toBuffer();
  }

  /** A paid booking whose pickup is open (it starts within 2 hours). */
  async function paidBooking() {
    const lender = await bookings.addUser({ name: 'Lena' });
    const renter = await bookings.addUser({ name: 'Rafael' });
    const item = await bookings.addItem(lender);
    const start = at(1);
    const requested: BookingView = await bookings.send(
      BookingsRpc.request,
      {
        bookingId: randomUUID(),
        itemId: item.itemId,
        start: start.toISOString(),
        end: new Date(start.getTime() + 3 * HOUR).toISOString(),
      },
      await as(renter),
    );
    const accepted: BookingView = await bookings.send(
      BookingsRpc.accept,
      { bookingId: requested.id },
      await as(lender),
    );
    await bookings.pay(accepted.id, accepted.price.totalCents);
    return { lender, renter, id: requested.id };
  }

  /** Asks for an upload URL and uploads to it, as the browser does. */
  async function upload(
    userId: string,
    bookingId: string,
    phase: 'PICKUP' | 'RETURN',
    body?: Buffer,
    photoId = randomUUID(),
  ): Promise<string> {
    const file = body ?? (await picture());
    const target = await bookings.send(
      BookingsRpc.photoUpload,
      {
        bookingId,
        photoId,
        phase,
        contentType: 'image/jpeg',
        sizeBytes: file.length,
      },
      await as(userId),
    );
    const response = await fetch(target.uploadUrl, {
      method: 'PUT',
      headers: target.uploadHeaders,
      body: file,
    });
    expect(response.status).toBe(200);
    return photoId;
  }

  const list = async (
    userId: string,
    bookingId: string,
  ): Promise<ConditionPhotosView> =>
    bookings.send(BookingsRpc.photoList, { bookingId }, await as(userId));

  async function confirmAndProcess(
    userId: string,
    bookingId: string,
    photoId: string,
  ): Promise<ConditionPhotoView> {
    await bookings.send(
      BookingsRpc.photoConfirm,
      { bookingId, photoId },
      await as(userId),
    );
    const deadline = Date.now() + 30_000;
    for (;;) {
      const photo = (await list(userId, bookingId)).photos.find(
        (p) => p.id === photoId,
      );
      if (photo && photo.status !== 'PENDING') return photo;
      if (Date.now() > deadline) throw new Error('photo never processed');
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async function fileKeyOf(photoId: string): Promise<string | null> {
    const [row] = await bookings.dataSource.query(
      `SELECT file_key FROM condition_photos WHERE id = $1`,
      [photoId],
    );
    return row?.file_key ?? null;
  }

  /**
   * Waits until the files are gone: the real worker may be running the
   * same cleanup (queued by the command or the sweep) and hold the row.
   */
  async function filesDeleted(fileKey: string): Promise<boolean> {
    const maintenance = bookings.app.get(PhotoMaintenance);
    const deadline = Date.now() + 15_000;
    for (;;) {
      await maintenance.cleanup();
      const left = await evidenceExists(fileKey);
      if (left.every((exists) => !exists)) return true;
      if (Date.now() > deadline) return false;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async function evidenceExists(fileKey: string): Promise<boolean[]> {
    return Promise.all(
      evidenceObjectKeys(fileKey).map(
        async (key) =>
          (await objectSize(admin, s3.evidenceBucket, key)) !== null,
      ),
    );
  }

  // --- tests ------------------------------------------------------------------

  it('processes both people’s photos into the private bucket and shows them to both', async () => {
    const { lender, renter, id } = await paidBooking();
    const fromLender = await upload(lender, id, 'PICKUP');
    const fromRenter = await upload(renter, id, 'PICKUP');

    const ready = await confirmAndProcess(lender, id, fromLender);
    expect(ready).toMatchObject({
      status: 'READY',
      phase: 'PICKUP',
      takenBy: 'LENDER',
      mine: true,
    });
    expect(ready.takenAt).not.toBeNull();
    await confirmAndProcess(renter, id, fromRenter);

    const seen = await list(renter, id);
    expect(seen.photos.map((p) => [p.takenBy, p.mine])).toEqual([
      ['LENDER', false],
      ['RENTER', true],
    ]);
    expect(seen.canAdd).toEqual({ PICKUP: true, RETURN: false });

    // The link works; the same object without a signature doesn't.
    const thumb = seen.photos[0].urls?.thumb as string;
    const shown = await fetch(thumb);
    expect(shown.status).toBe(200);
    expect(shown.headers.get('content-type')).toBe('image/webp');
    expect((await fetch(thumb.split('?')[0])).status).toBe(403);
    expect(
      (await sharp(Buffer.from(await shown.arrayBuffer())).metadata()).width,
    ).toBe(320);
    expect(
      await evidenceExists((await fileKeyOf(fromLender)) as string),
    ).toEqual([true, true]);

    // Outsiders see nothing, not even that the booking exists.
    const stranger = await bookings.addUser();
    expect(await failure(list(stranger, id))).toBe('NOT_FOUND');
  });

  it('allows three photos per person and handoff; failed ones do not count', async () => {
    const { renter, id } = await paidBooking();
    const tiny = await upload(renter, id, 'PICKUP', await picture(200, 150));
    expect((await confirmAndProcess(renter, id, tiny)).status).toBe('FAILED');

    for (let i = 0; i < CONDITION_PHOTOS_MAX_PER_PHASE; i++) {
      await upload(renter, id, 'PICKUP');
    }
    expect(await failure(upload(renter, id, 'PICKUP'))).toBe(
      'PHOTO_LIMIT_REACHED',
    );
    expect((await list(renter, id)).canAdd.PICKUP).toBe(false);
  });

  it('returns the same upload for a repeated request', async () => {
    const { renter, id } = await paidBooking();
    const photoId = randomUUID();
    await upload(renter, id, 'PICKUP', undefined, photoId);
    await upload(renter, id, 'PICKUP', undefined, photoId);
    expect((await list(renter, id)).photos).toHaveLength(1);
  });

  it('opens each handoff’s photos only in its window', async () => {
    const { lender, renter, id } = await paidBooking();
    expect(await failure(upload(renter, id, 'RETURN'))).toBe('INVALID_STATE');
    const early = await upload(renter, id, 'PICKUP');

    // Picked up 3 hours ago: pickup photos closed, return photos open.
    await bookings.dataSource.query(
      `UPDATE bookings SET status = 'PICKED_UP',
              picked_up_at = now() - interval '3 hours' WHERE id = $1`,
      [id],
    );
    expect(await failure(upload(lender, id, 'PICKUP'))).toBe('INVALID_STATE');
    expect(
      await failure(
        bookings.send(
          BookingsRpc.photoRemove,
          { bookingId: id, photoId: early },
          await as(renter),
        ),
      ),
    ).toBe('INVALID_STATE');
    await upload(lender, id, 'RETURN');
    expect((await list(lender, id)).canAdd).toEqual({
      PICKUP: false,
      RETURN: true,
    });
  });

  it('lets only the uploader remove a photo, and deletes its files', async () => {
    const { lender, renter, id } = await paidBooking();
    const photoId = await upload(renter, id, 'PICKUP');
    await confirmAndProcess(renter, id, photoId);
    const fileKey = (await fileKeyOf(photoId)) as string;

    expect(
      await failure(
        bookings.send(
          BookingsRpc.photoRemove,
          { bookingId: id, photoId },
          await as(lender),
        ),
      ),
    ).toBe('NOT_FOUND');
    await bookings.send(
      BookingsRpc.photoRemove,
      { bookingId: id, photoId },
      await as(renter),
    );
    // Repeating is fine.
    await bookings.send(
      BookingsRpc.photoRemove,
      { bookingId: id, photoId },
      await as(renter),
    );
    expect((await list(renter, id)).photos).toEqual([]);
    expect(await filesDeleted(fileKey)).toBe(true);
  });

  it('deletes the photos 30 days after the booking finished', async () => {
    const { renter, id } = await paidBooking();
    const photoId = await upload(renter, id, 'PICKUP');
    await confirmAndProcess(renter, id, photoId);
    const fileKey = (await fileKeyOf(photoId)) as string;
    const maintenance = bookings.app.get(PhotoMaintenance);

    await bookings.dataSource.query(
      `UPDATE bookings SET status = 'COMPLETED',
              updated_at = now() - interval '29 days' WHERE id = $1`,
      [id],
    );
    await maintenance.sweep();
    expect(await fileKeyOf(photoId)).toBe(fileKey);

    await bookings.dataSource.query(
      `UPDATE bookings SET updated_at = now() - interval '31 days' WHERE id = $1`,
      [id],
    );
    expect((await maintenance.sweep()).expired).toBeGreaterThanOrEqual(1);
    expect(await fileKeyOf(photoId)).toBeNull();
    expect(await filesDeleted(fileKey)).toBe(true);
  });

  it('exports the caller’s own photos, and erases them with the account', async () => {
    const { lender, renter, id } = await paidBooking();
    const mine = await upload(renter, id, 'PICKUP');
    const theirs = await upload(lender, id, 'PICKUP');
    await confirmAndProcess(renter, id, mine);
    await confirmAndProcess(lender, id, theirs);

    const data: BookingsDataExport = await bookings.send(
      BookingsRpc.exportMe,
      {},
      await as(renter),
    );
    expect(data.conditionPhotos).toHaveLength(1);
    expect(data.conditionPhotos[0]).toMatchObject({
      bookingId: id,
      phase: 'PICKUP',
    });
    expect(
      (await fetch(data.conditionPhotos[0].urls?.large as string)).status,
    ).toBe(200);

    await bookings.deleteUser(renter);
    const left = await bookings.dataSource.query(
      `SELECT uploader_id FROM condition_photos WHERE booking_id = $1`,
      [id],
    );
    expect(left).toEqual([{ uploader_id: lender }]);
  });
});
