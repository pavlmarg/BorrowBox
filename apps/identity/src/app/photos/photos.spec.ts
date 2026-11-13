import type { S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import {
  IdentityRpc,
  PROFILE_PHOTO_VARIANTS,
  type AuthSession,
  type RpcErrorBody,
  type UserProfile,
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
  startIdentity,
  type IdentityHarness,
} from '../../testing/identity-harness';
import { PhotoMaintenance } from './photo-maintenance';
import { profilePhotoObjectKey } from './photos.repository';

/**
 * Profile photos end to end (ADR-0024): presigned upload, confirm, the real
 * BullMQ worker, storage, the event, cleanup, erasure and the sweeper, with
 * Postgres, RabbitMQ, Redis and SeaweedFS all real.
 */
describe('Profile photos (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let redis: TestRedis;
  let s3: TestS3;
  let identity: IdentityHarness;
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
    identity = await startIdentity({
      databaseUrl: pg.urlFor('identity'),
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
    await identity?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop(), redis?.stop(), s3?.stop()]);
  });

  // --- helpers ----------------------------------------------------------------

  const PASSWORD = 'correct horse 42';
  let n = 0;
  const signUp = (): Promise<AuthSession> =>
    identity.send(IdentityRpc.register, {
      email: `photo${++n}@example.com`,
      password: PASSWORD,
      displayName: `Photo ${n}`,
    });
  const as = (s: AuthSession) => ({ accessToken: s.accessToken });

  async function failure(promise: Promise<unknown>): Promise<RpcErrorBody> {
    try {
      await promise;
    } catch (err) {
      return err as RpcErrorBody;
    }
    throw new Error('expected the call to fail');
  }

  function picture(width = 1200, height = 800): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 30, g: 90, b: 160 },
      },
    })
      .jpeg()
      .toBuffer();
  }

  /** Asks for an upload URL and uploads to it, as the browser does. */
  async function upload(s: AuthSession, body: Buffer): Promise<void> {
    const target = await identity.send(
      IdentityRpc.requestPhotoUpload,
      { contentType: 'image/jpeg', sizeBytes: body.length },
      as(s),
    );
    const response = await fetch(target.uploadUrl, {
      method: 'PUT',
      headers: target.uploadHeaders,
      body,
    });
    expect(response.status).toBe(200);
  }

  async function waitFor<T>(
    check: () => Promise<T | undefined | null | false>,
    what: string,
  ): Promise<T> {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const value = await check();
      if (value) return value;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${what}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const me = (s: AuthSession): Promise<UserProfile> =>
    identity.send(IdentityRpc.getMe, {}, as(s));

  /** Confirms and waits until the worker has finished with the upload. */
  async function confirmAndProcess(s: AuthSession): Promise<UserProfile> {
    await identity.send(IdentityRpc.confirmPhoto, {}, as(s));
    return waitFor(async () => {
      const profile = await me(s);
      return profile.photoUpload !== 'PENDING' ? profile : undefined;
    }, 'processing');
  }

  const publicKeyOf = (profile: UserProfile): string =>
    /\/profiles\/([0-9a-f-]{36})\//.exec(profile.photo?.small ?? '')?.[1] ?? '';

  const publicFilesExist = (publicKey: string): Promise<boolean[]> =>
    Promise.all(
      Object.values(PROFILE_PHOTO_VARIANTS).map(
        async (edge) =>
          (await objectSize(
            admin,
            s3.publicBucket,
            profilePhotoObjectKey(publicKey, edge),
          )) !== null,
      ),
    );

  const noPendingDeletions = async () => {
    const [{ count }] = await identity.dataSource.query(
      `SELECT count(*)::int AS count FROM photo_file_deletions WHERE not_before <= now()`,
    );
    return count === 0;
  };

  /** The `user.profile_updated` payloads written for this user, oldest first. */
  const announced = async (userId: string): Promise<unknown[]> =>
    (
      await identity.dataSource.query(
        `SELECT envelope->'payload' AS payload FROM outbox
          WHERE routing_key = 'user.profile_updated.v1'
            AND envelope->'payload'->>'userId' = $1
          ORDER BY id`,
        [userId],
      )
    ).map((r: { payload: unknown }) => r.payload);

  // --- the happy path ------------------------------------------------------------

  it('turns an upload into public square sizes, announces it and removes the original', async () => {
    const s = await signUp();
    expect(s.user.photo).toBeNull();
    expect(s.user.photoUpload).toBeNull();

    await upload(s, await picture());
    expect((await me(s)).photoUpload).toBe('PENDING');
    const [{ upload_key }] = await identity.dataSource.query(
      `SELECT upload_key FROM user_photos WHERE user_id = $1`,
      [s.user.id],
    );

    const profile = await confirmAndProcess(s);
    expect(profile.photoUpload).toBeNull();
    const key = publicKeyOf(profile);
    expect(profile.photo).toEqual({
      small: `${s3.endpoint}/${s3.publicBucket}/profiles/${key}/96.webp`,
      large: `${s3.endpoint}/${s3.publicBucket}/profiles/${key}/512.webp`,
    });

    // Public, square, anonymous read.
    const response = await fetch(profile.photo?.large ?? '');
    expect(response.status).toBe(200);
    const meta = await sharp(
      Buffer.from(await response.arrayBuffer()),
    ).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 512, 512]);

    // Catalog and Bookings hear about it, with the name and language too.
    expect(await announced(s.user.id)).toEqual([
      {
        userId: s.user.id,
        displayName: s.user.displayName,
        locale: s.user.locale,
        photo: profile.photo,
        bio: null,
      },
    ]);

    await waitFor(noPendingDeletions, 'cleanup');
    expect(await objectSize(admin, s3.uploadsBucket, upload_key)).toBeNull();
  });

  it('keeps the old photo until the new one is ready, then deletes its files', async () => {
    const s = await signUp();
    await upload(s, await picture());
    const first = publicKeyOf(await confirmAndProcess(s));

    await upload(s, await picture(900, 900));
    // Still the first one while the new upload waits.
    expect(publicKeyOf(await me(s))).toBe(first);
    const second = publicKeyOf(await confirmAndProcess(s));
    expect(second).not.toBe(first);

    await waitFor(noPendingDeletions, 'cleanup');
    expect(await publicFilesExist(first)).toEqual([false, false]);
    expect(await publicFilesExist(second)).toEqual([true, true]);
  });

  // --- refusals and rejects ----------------------------------------------------------

  it('refuses to confirm before the file arrived or with nothing waiting', async () => {
    const s = await signUp();
    expect(
      await failure(identity.send(IdentityRpc.confirmPhoto, {}, as(s))),
    ).toEqual({ code: 'INVALID_STATE', message: 'No photo upload is waiting' });

    await identity.send(
      IdentityRpc.requestPhotoUpload,
      { contentType: 'image/jpeg', sizeBytes: 1000 },
      as(s),
    );
    expect(
      await failure(identity.send(IdentityRpc.confirmPhoto, {}, as(s))),
    ).toEqual({
      code: 'INVALID_STATE',
      message: "The photo hasn't been uploaded yet",
    });
  });

  it('validates the upload request', async () => {
    const s = await signUp();
    const err = await failure(
      identity.send(
        IdentityRpc.requestPhotoUpload,
        { contentType: 'image/svg+xml', sizeBytes: 0 },
        as(s),
      ),
    );
    expect(err.code).toBe('VALIDATION_FAILED');
  });

  it('marks a photo that is too small FAILED and keeps the current one', async () => {
    const s = await signUp();
    await upload(s, await picture());
    const current = await confirmAndProcess(s);

    await upload(s, await picture(400, 100)); // shorter side under 128 px
    const after = await confirmAndProcess(s);
    expect(after.photoUpload).toBe('FAILED');
    expect(after.photo).toEqual(current.photo);
    // Nothing new to announce.
    expect(await announced(s.user.id)).toHaveLength(1);
  });

  // --- removing --------------------------------------------------------------------------

  it('removes the photo, announces it and deletes the files', async () => {
    const s = await signUp();
    await upload(s, await picture());
    const key = publicKeyOf(await confirmAndProcess(s));

    const profile = await identity.send(IdentityRpc.removePhoto, {}, as(s));
    expect(profile.photo).toBeNull();
    expect((await announced(s.user.id)).at(-1)).toMatchObject({ photo: null });
    await waitFor(noPendingDeletions, 'cleanup');
    expect(await publicFilesExist(key)).toEqual([false, false]);

    // Without a photo it's a no-op: nothing new announced.
    await identity.send(IdentityRpc.removePhoto, {}, as(s));
    expect(await announced(s.user.id)).toHaveLength(2);
  });

  // --- GDPR ----------------------------------------------------------------------------------

  it('exports the photo, and erasure deletes it and blanks it in old events', async () => {
    const s = await signUp();
    await upload(s, await picture());
    const profile = await confirmAndProcess(s);
    const key = publicKeyOf(profile);

    const exported = await identity.send(IdentityRpc.exportMe, {}, as(s));
    expect(exported.user.photo).toEqual(profile.photo);

    await identity.send(IdentityRpc.deleteMe, { password: PASSWORD }, as(s));
    const [user] = await identity.dataSource.query(
      `SELECT photo_key FROM users WHERE id = $1`,
      [s.user.id],
    );
    expect(user.photo_key).toBeNull();
    for (const payload of await announced(s.user.id)) {
      expect(payload).toMatchObject({ photo: null });
    }
    await waitFor(noPendingDeletions, 'cleanup');
    expect(await publicFilesExist(key)).toEqual([false, false]);
  });

  // --- the sweeper ------------------------------------------------------------------------------

  it('drops day-old unfinished uploads with their files', async () => {
    const s = await signUp();
    await upload(s, await picture());
    await identity.dataSource.query(
      `UPDATE user_photos SET created_at = now() - interval '25 hours'
        WHERE user_id = $1`,
      [s.user.id],
    );
    const [{ upload_key }] = await identity.dataSource.query(
      `SELECT upload_key FROM user_photos WHERE user_id = $1`,
      [s.user.id],
    );

    const result = await identity.app.get(PhotoMaintenance).sweep();
    expect(result.abandoned).toBeGreaterThanOrEqual(1);
    expect((await me(s)).photoUpload).toBeNull();
    await waitFor(noPendingDeletions, 'cleanup');
    expect(await objectSize(admin, s3.uploadsBucket, upload_key)).toBeNull();
  });
});
