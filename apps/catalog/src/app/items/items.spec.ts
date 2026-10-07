import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import {
  CatalogRpc,
  ITEM_FREE_LIMIT,
  type CatalogRpcPattern,
  type CreateItemRequest,
  type EventEnvelope,
  type GeoPoint,
  type OwnItem,
  type RpcErrorBody,
} from '@borrowbox/contracts';
import {
  startPostgres,
  startRabbitMq,
  type TestPostgres,
  type TestRabbitMq,
} from '@borrowbox/testing';
import {
  startCatalog,
  TEST_PHOTOS_BASE_URL,
  type CatalogHarness,
} from '../../testing/catalog-harness';

/**
 * The lender's item commands over real TCP, against Postgres + PostGIS and
 * RabbitMQ: rules, events, the item limit, and location fuzzing (ADR-0007).
 */
describe('Item commands (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let catalog: CatalogHarness;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    [pg, rabbit] = await Promise.all([startPostgres(), startRabbitMq()]);
    catalog = await startCatalog({
      databaseUrl: pg.urlFor('catalog'),
      rabbitmqUrl: rabbit.url,
    });
  });

  afterAll(async () => {
    await catalog?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop()]);
  });

  // --- helpers ----------------------------------------------------------------

  const ATHENS: GeoPoint = { lat: 37.9838, lng: 23.7275 };

  /** Sends as `userId` (with a fresh valid token). */
  async function as<P extends CatalogRpcPattern>(
    userId: string,
    pattern: P,
    data: unknown,
    correlationId = 'test-correlation',
  ) {
    return catalog.send(pattern, data, {
      accessToken: await catalog.tokenFor(userId),
      correlationId,
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

  function newItem(overrides: Partial<CreateItemRequest> = {}) {
    return {
      itemId: randomUUID(),
      title: 'Cordless drill',
      description: 'Two batteries included',
      category: 'tools',
      pricing: { free: false, dailyCents: 500 },
      depositCents: 2000,
      ...overrides,
    } satisfies CreateItemRequest;
  }

  async function create(
    userId: string,
    overrides: Partial<CreateItemRequest> = {},
  ): Promise<OwnItem> {
    return as(userId, CatalogRpc.create, newItem(overrides));
  }

  /** Every outbox envelope about `itemId`, oldest first. */
  async function eventsFor(itemId: string): Promise<EventEnvelope[]> {
    const rows = await catalog.dataSource.query(
      `SELECT envelope FROM outbox
        WHERE envelope->'payload'->>'itemId' = $1 ORDER BY id`,
      [itemId],
    );
    return rows.map((r: { envelope: EventEnvelope }) => r.envelope);
  }

  async function addPhoto(
    itemId: string,
    status: 'PENDING' | 'READY',
    position = 0,
  ): Promise<string> {
    const [{ id }] = await catalog.dataSource.query(
      `INSERT INTO item_photos (item_id, status, position, upload_key, content_type, size_bytes, public_key)
       VALUES ($1, $2, $3, $4, 'image/jpeg', 1000, $5) RETURNING id`,
      [
        itemId,
        status,
        position,
        `incoming/${randomUUID()}`,
        status === 'READY' ? randomUUID() : null,
      ],
    );
    return id;
  }

  /** A located item with a processed photo, ready to publish. */
  async function publishable(userId: string): Promise<OwnItem> {
    const item = await create(userId);
    await as(userId, CatalogRpc.setLocation, {
      itemId: item.id,
      location: ATHENS,
    });
    await addPhoto(item.id, 'READY');
    return item;
  }

  interface Placement {
    offset_m: number;
    offset_bearing: number;
    /** Metres from the exact to the public point, measured by PostGIS. */
    fuzz_m: number;
    /** Degrees from the exact to the public point, measured by PostGIS. */
    fuzz_bearing: number | null;
  }

  async function placement(itemId: string): Promise<Placement> {
    const [row] = await catalog.dataSource.query(
      `SELECT offset_m, offset_bearing,
              ST_Distance(location, location_public) AS fuzz_m,
              degrees(ST_Azimuth(location, location_public)) AS fuzz_bearing
         FROM items WHERE id = $1`,
      [itemId],
    );
    return row;
  }

  /** The point `metres` from `from`, heading `bearingDeg` (PostGIS). */
  async function pointFrom(
    from: GeoPoint,
    metres: number,
    bearingDeg: number,
  ): Promise<GeoPoint> {
    const [row] = await catalog.dataSource.query(
      `SELECT ST_Y(p::geometry) AS lat, ST_X(p::geometry) AS lng FROM (
         SELECT ST_Project(ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography, $3::float8, radians($4::float8)) AS p
       ) q`,
      [from.lat, from.lng, metres, bearingDeg],
    );
    return row;
  }

  // --- authentication and ownership ------------------------------------------

  describe('who may do what', () => {
    const patterns: CatalogRpcPattern[] = [
      CatalogRpc.create,
      CatalogRpc.update,
      CatalogRpc.setLocation,
      CatalogRpc.publish,
      CatalogRpc.pause,
      CatalogRpc.unpause,
      CatalogRpc.delete,
      CatalogRpc.getOwn,
      CatalogRpc.listMine,
    ];

    it.each(patterns)('%s needs a valid access token', async (pattern) => {
      expect(await failure(catalog.send(pattern, {}))).toEqual({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
      expect(
        (await failure(catalog.send(pattern, {}, { accessToken: 'x.y.z' })))
          .code,
      ).toBe('UNAUTHENTICATED');
    });

    it("never touches or confirms someone else's item", async () => {
      const owner = randomUUID();
      const other = randomUUID();
      const item = await publishable(owner);
      const ref = { itemId: item.id };

      for (const [pattern, data] of [
        [CatalogRpc.getOwn, ref],
        [CatalogRpc.update, { ...ref, title: 'Mine now' }],
        [CatalogRpc.setLocation, { ...ref, location: ATHENS }],
        [CatalogRpc.publish, ref],
        [CatalogRpc.pause, ref],
        [CatalogRpc.unpause, ref],
        [CatalogRpc.delete, ref],
      ] as const) {
        expect(await failure(as(other, pattern, data))).toEqual({
          code: 'NOT_FOUND',
          message: 'Item not found',
        });
      }
      expect(await as(other, CatalogRpc.listMine, {})).toEqual([]);
      const unchanged = await as(owner, CatalogRpc.getOwn, ref);
      expect(unchanged).toMatchObject({
        title: 'Cordless drill',
        status: 'DRAFT',
      });
      expect(await eventsFor(item.id)).toHaveLength(1); // item.created only
    });

    it('refuses writes once the account deletion has been processed', async () => {
      const userId = randomUUID();
      const item = await create(userId);
      await catalog.dataSource.query(
        `INSERT INTO lenders (user_id, name_updated_at, deleted_at) VALUES ($1, now(), now())`,
        [userId],
      );
      const ref = { itemId: item.id };
      for (const [pattern, data] of [
        [CatalogRpc.create, newItem()],
        [CatalogRpc.update, { ...ref, title: 'After deletion' }],
        [CatalogRpc.setLocation, { ...ref, location: ATHENS }],
        [CatalogRpc.publish, ref],
        [CatalogRpc.pause, ref],
        [CatalogRpc.unpause, ref],
        [CatalogRpc.delete, ref],
      ] as const) {
        expect((await failure(as(userId, pattern, data))).code).toBe(
          'UNAUTHENTICATED',
        );
      }
      const [{ count }] = await catalog.dataSource.query(
        `SELECT count(*)::int AS count FROM items WHERE lender_id = $1`,
        [userId],
      );
      expect(count).toBe(1);
    });
  });

  // --- create ---------------------------------------------------------------------

  describe('create', () => {
    it('creates a draft and emits item.created without location or description', async () => {
      const userId = randomUUID();
      const input = newItem({ title: '  Δράπανο μπαταρίας  ' });
      const item = await as(userId, CatalogRpc.create, input, 'corr-create');

      expect(item).toEqual({
        id: input.itemId,
        status: 'DRAFT',
        title: 'Δράπανο μπαταρίας',
        description: 'Two batteries included',
        category: 'tools',
        pricing: { free: false, dailyCents: 500 },
        depositCents: 2000,
        location: null,
        approximateLocation: null,
        photos: [],
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        publishedAt: null,
      });

      const [event, ...rest] = await eventsFor(item.id);
      expect(rest).toEqual([]);
      expect(event).toMatchObject({
        type: 'item.created',
        version: 1,
        correlationId: 'corr-create',
        causationId: null,
      });
      expect(event.payload).toEqual({
        itemId: item.id,
        lenderId: userId,
        title: 'Δράπανο μπαταρίας',
        category: 'tools',
        pricing: { free: false, dailyCents: 500 },
        depositCents: 2000,
        status: 'DRAFT',
      });
    });

    it('defaults the description to empty and counts title length in characters', async () => {
      const item = await create(randomUUID(), {
        title: '🔨🪚🪛',
        description: undefined,
      });
      expect(item).toMatchObject({ title: '🔨🪚🪛', description: '' });
      expect(
        (await failure(create(randomUUID(), { title: '🔨🪚' }))).code,
      ).toBe('VALIDATION_FAILED');
    });

    it.each([
      ['an unknown field', { extra: true }],
      ['a malformed id', { itemId: 'item-1' }],
      ['a short title', { title: ' ab ' }],
      ['an unknown category', { category: 'weapons' }],
      ['free with a rate', { pricing: { free: true, dailyCents: 500 } }],
      ['no rate and not free', { pricing: { free: false } }],
      ['a rate below the minimum', { pricing: { free: false, dailyCents: 9 } }],
      ['a fractional rate', { pricing: { free: false, dailyCents: 10.5 } }],
      ['an unknown pricing field', { pricing: { free: true, yearlyCents: 1 } }],
      ['pricing as a list', { pricing: [] }],
      ['a negative deposit', { depositCents: -1 }],
      ['a deposit over the maximum', { depositCents: 500_001 }],
    ])('rejects %s, naming fields but not values', async (_, overrides) => {
      const error = await failure(
        as(randomUUID(), CatalogRpc.create, { ...newItem(), ...overrides }),
      );
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.message).toMatch(/^Invalid fields: /);
      expect(error.message).not.toMatch(/weapons|item-1|yearly|500001/);
    });

    it('returns the same item when the same create is sent again (D8)', async () => {
      const userId = randomUUID();
      const input = newItem();
      const first = await as(userId, CatalogRpc.create, input);
      const again = await as(userId, CatalogRpc.create, {
        ...input,
        title: 'A different title',
      });
      expect(again).toEqual(first);
      expect(await eventsFor(input.itemId)).toHaveLength(1);
    });

    it("refuses an id that is someone else's, without revealing it", async () => {
      const theirs = await create(randomUUID());
      const error = await failure(
        create(randomUUID(), { itemId: theirs.id, title: 'Hijack' }),
      );
      expect(error).toEqual({
        code: 'VALIDATION_FAILED',
        message: 'Invalid fields: itemId',
      });
      expect(JSON.stringify(error)).not.toContain('Cordless');
    });

    it('refuses to reuse the id of a deleted item', async () => {
      const userId = randomUUID();
      const item = await create(userId);
      await as(userId, CatalogRpc.delete, { itemId: item.id });
      expect((await failure(create(userId, { itemId: item.id }))).code).toBe(
        'VALIDATION_FAILED',
      );
    });

    it(`allows ${ITEM_FREE_LIMIT} items, drafts included, and deleting one frees a slot`, async () => {
      const userId = randomUUID();
      const items: OwnItem[] = [];
      for (let i = 0; i < ITEM_FREE_LIMIT; i++)
        items.push(await create(userId));

      expect(await failure(create(userId))).toEqual({
        code: 'ITEM_LIMIT_REACHED',
        message: `You can have up to ${ITEM_FREE_LIMIT} items`,
      });
      // A retried create of an item that exists isn't a new item.
      const replay = await as(userId, CatalogRpc.create, {
        ...newItem(),
        itemId: items[0].id,
      });
      expect(replay.id).toBe(items[0].id);

      await as(userId, CatalogRpc.delete, { itemId: items[3].id });
      await create(userId);
      expect((await failure(create(userId))).code).toBe('ITEM_LIMIT_REACHED');
    });

    it('never lets parallel creates exceed the limit', async () => {
      const userId = randomUUID();
      const results = await Promise.allSettled(
        Array.from({ length: ITEM_FREE_LIMIT + 3 }, () => create(userId)),
      );
      const created = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter(
        (r) =>
          r.status === 'rejected' &&
          (r.reason as RpcErrorBody).code === 'ITEM_LIMIT_REACHED',
      );
      expect(created).toHaveLength(ITEM_FREE_LIMIT);
      expect(refused).toHaveLength(3);
      const [{ count }] = await catalog.dataSource.query(
        `SELECT count(*)::int AS count FROM items WHERE lender_id = $1`,
        [userId],
      );
      expect(count).toBe(ITEM_FREE_LIMIT);
    });

    it("waits for the lender's item lock, which account erasure also takes", async () => {
      const userId = randomUUID();
      const other = new Client({ connectionString: pg.urlFor('catalog') });
      await other.connect();
      try {
        await other.query('BEGIN');
        await other.query(`SELECT pg_advisory_xact_lock(1001, hashtext($1))`, [
          userId,
        ]);
        let settled = false;
        const pending = create(userId).finally(() => (settled = true));
        await new Promise((r) => setTimeout(r, 750));
        expect(settled).toBe(false);

        await other.query('COMMIT');
        await expect(pending).resolves.toMatchObject({ status: 'DRAFT' });
      } finally {
        await other.end();
      }
    });
  });

  // --- update ---------------------------------------------------------------------

  describe('update', () => {
    it('changes only the fields sent, and emits the new snapshot', async () => {
      const userId = randomUUID();
      const item = await create(userId);
      const updated = await as(
        userId,
        CatalogRpc.update,
        {
          itemId: item.id,
          title: 'Hammer drill',
          pricing: { free: true },
          depositCents: 0,
        },
        'corr-update',
      );
      expect(updated).toMatchObject({
        title: 'Hammer drill',
        description: 'Two batteries included',
        category: 'tools',
        pricing: { free: true },
        depositCents: 0,
      });
      const events = await eventsFor(item.id);
      expect(events.map((e) => e.type)).toEqual([
        'item.created',
        'item.updated',
      ]);
      expect(events[1]).toMatchObject({
        correlationId: 'corr-update',
        payload: {
          title: 'Hammer drill',
          pricing: { free: true },
          depositCents: 0,
          status: 'DRAFT',
        },
      });
    });

    it('emits nothing for a description-only change or for no change', async () => {
      const userId = randomUUID();
      const item = await create(userId);
      const described = await as(userId, CatalogRpc.update, {
        itemId: item.id,
        description: 'Now with a case',
      });
      expect(described.description).toBe('Now with a case');

      const same = await as(userId, CatalogRpc.update, {
        itemId: item.id,
        title: 'Cordless drill',
        pricing: { dailyCents: 500, free: false },
      });
      expect(same.updatedAt).toBe(described.updatedAt);
      expect(await eventsFor(item.id)).toHaveLength(1);
    });

    it('clears the description with an empty string', async () => {
      const userId = randomUUID();
      const item = await create(userId);
      const updated = await as(userId, CatalogRpc.update, {
        itemId: item.id,
        description: '   ',
      });
      expect(updated.description).toBe('');
    });

    it('rejects invalid values like create does', async () => {
      const userId = randomUUID();
      const item = await create(userId);
      expect(
        (
          await failure(
            as(userId, CatalogRpc.update, {
              itemId: item.id,
              pricing: { free: false },
            }),
          )
        ).code,
      ).toBe('VALIDATION_FAILED');
    });
  });

  // --- location (ADR-0007) ------------------------------------------------------------

  describe('setLocation', () => {
    it('stores the exact pin and a public point 150-300 m away', async () => {
      const userId = randomUUID();
      const item = await create(userId);
      const located = await as(userId, CatalogRpc.setLocation, {
        itemId: item.id,
        location: ATHENS,
      });
      expect(located.location).toEqual(ATHENS);
      expect(located.approximateLocation).not.toEqual(ATHENS);

      const p = await placement(item.id);
      expect(p.fuzz_m).toBeCloseTo(p.offset_m, 3);
      expect(p.fuzz_m).toBeGreaterThanOrEqual(150 - 0.001);
      expect(p.fuzz_m).toBeLessThanOrEqual(300 + 0.001);
      // Only the owner's view; no event carries a location.
      expect(await eventsFor(item.id)).toHaveLength(1);
    });

    it('applies the stored offset exactly, anywhere on Earth', async () => {
      const userId = randomUUID();
      const spots: GeoPoint[] = [
        ATHENS,
        { lat: 0, lng: 0 },
        { lat: -33.8688, lng: 151.2093 },
        { lat: 64.1466, lng: -21.9426 },
        { lat: 35.3387, lng: 25.1442 },
        { lat: 0.0001, lng: 179.9999 }, // across the antimeridian
        { lat: -0.0001, lng: -179.9999 },
        { lat: 89.99, lng: 10 }, // close to the poles
        { lat: -89.99, lng: -10 },
      ];
      // ITEM_FREE_LIMIT per lender: one pin per item, reused for each spot.
      const item = await create(userId);
      for (const spot of spots) {
        // Far apart, so each spot draws a fresh offset.
        await as(userId, CatalogRpc.setLocation, {
          itemId: item.id,
          location: spot,
        });
        const p = await placement(item.id);
        expect(p.fuzz_m).toBeCloseTo(p.offset_m, 3);
        expect(p.offset_m).toBeGreaterThanOrEqual(150);
        expect(p.offset_m).toBeLessThanOrEqual(300);
        if (Math.abs(spot.lat) < 80) {
          const diff = Math.abs(
            (((p.fuzz_bearing ?? 0) - p.offset_bearing + 540) % 360) - 180,
          );
          expect(diff).toBeLessThan(0.01);
        }
      }
    });

    it('spreads offsets over the whole range across many items', async () => {
      const distances: number[] = [];
      const bearings: number[] = [];
      for (let lender = 0; lender < 6; lender++) {
        const userId = randomUUID();
        for (let i = 0; i < ITEM_FREE_LIMIT; i++) {
          const item = await create(userId);
          await as(userId, CatalogRpc.setLocation, {
            itemId: item.id,
            location: ATHENS,
          });
          const p = await placement(item.id);
          distances.push(p.fuzz_m);
          bearings.push(p.offset_bearing);
        }
      }
      // 60 independent draws: all in range, and not bunched in one part of it.
      expect(Math.min(...distances)).toBeGreaterThanOrEqual(150 - 0.001);
      expect(Math.max(...distances)).toBeLessThanOrEqual(300 + 0.001);
      expect(distances.filter((d) => d < 225).length).toBeGreaterThan(10);
      expect(distances.filter((d) => d >= 225).length).toBeGreaterThan(10);
      for (let quarter = 0; quarter < 4; quarter++) {
        expect(
          bearings.filter((b) => Math.floor(b / 90) === quarter).length,
        ).toBeGreaterThan(3);
      }
    });

    it('keeps the offset when the pin moves less than 300 m', async () => {
      const userId = randomUUID();
      const item = await create(userId);
      await as(userId, CatalogRpc.setLocation, {
        itemId: item.id,
        location: ATHENS,
      });
      const before = await placement(item.id);
      const first = await as(userId, CatalogRpc.getOwn, { itemId: item.id });

      // Same pin again: nothing moves.
      await as(userId, CatalogRpc.setLocation, {
        itemId: item.id,
        location: ATHENS,
      });
      expect(await placement(item.id)).toEqual(before);

      const moved = await pointFrom(ATHENS, 299, 70);
      const after = await as(userId, CatalogRpc.setLocation, {
        itemId: item.id,
        location: moved,
      });
      const p = await placement(item.id);
      expect(p.offset_m).toBe(before.offset_m);
      expect(p.offset_bearing).toBe(before.offset_bearing);
      // The public point moved as far as the pin did.
      const [{ shift }] = await catalog.dataSource.query(
        `SELECT ST_Distance(
           ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography,
           ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326)::geography) AS shift`,
        [
          first.approximateLocation?.lng,
          first.approximateLocation?.lat,
          after.approximateLocation?.lng,
          after.approximateLocation?.lat,
        ],
      );
      expect(shift).toBeGreaterThan(298);
      expect(shift).toBeLessThan(300);
    });

    it('draws a new offset when the pin moves 300 m or more', async () => {
      const userId = randomUUID();
      const item = await create(userId);
      await as(userId, CatalogRpc.setLocation, {
        itemId: item.id,
        location: ATHENS,
      });
      const before = await placement(item.id);
      await as(userId, CatalogRpc.setLocation, {
        itemId: item.id,
        location: await pointFrom(ATHENS, 300.5, 70),
      });
      const after = await placement(item.id);
      expect([after.offset_m, after.offset_bearing]).not.toEqual([
        before.offset_m,
        before.offset_bearing,
      ]);
      expect(after.fuzz_m).toBeCloseTo(after.offset_m, 3);
    });

    it.each([
      ['a latitude past the pole', { lat: 90.1, lng: 0 }],
      ['a longitude past 180°', { lat: 0, lng: 180.5 }],
      ['coordinates as text', { lat: '37.9', lng: '23.7' }],
      ['a missing coordinate', { lat: 37.9 }],
      ['no location', undefined],
    ])('rejects %s', async (_, location) => {
      const userId = randomUUID();
      const item = await create(userId);
      expect(
        (
          await failure(
            as(userId, CatalogRpc.setLocation, { itemId: item.id, location }),
          )
        ).code,
      ).toBe('VALIDATION_FAILED');
    });
  });

  // --- lifecycle ------------------------------------------------------------------

  describe('publish, pause and unpause', () => {
    it('needs a location and a processed photo to publish', async () => {
      const userId = randomUUID();
      const item = await create(userId);
      const ref = { itemId: item.id };
      const notPublishable = {
        code: 'NOT_PUBLISHABLE',
        message:
          'An item needs a location and a photo before it can be published',
      };

      await addPhoto(item.id, 'READY');
      expect(await failure(as(userId, CatalogRpc.publish, ref))).toEqual(
        notPublishable,
      );

      const other = await create(userId);
      await as(userId, CatalogRpc.setLocation, {
        itemId: other.id,
        location: ATHENS,
      });
      await addPhoto(other.id, 'PENDING');
      expect(
        await failure(as(userId, CatalogRpc.publish, { itemId: other.id })),
      ).toEqual(notPublishable);
    });

    it('publishes once, then repeating it changes nothing', async () => {
      const userId = randomUUID();
      const item = await publishable(userId);
      const ref = { itemId: item.id };
      const published = await as(userId, CatalogRpc.publish, ref, 'corr-pub');
      expect(published.status).toBe('ACTIVE');
      expect(published.publishedAt).toEqual(expect.any(String));
      expect(published.photos).toEqual([
        {
          id: expect.any(String),
          status: 'READY',
          position: 0,
          urls: {
            small: expect.stringMatching(
              new RegExp(
                `^${TEST_PHOTOS_BASE_URL}/items/[0-9a-f-]{36}/320\\.webp$`,
              ),
            ),
            medium: expect.stringMatching(/\/800\.webp$/),
            large: expect.stringMatching(/\/1600\.webp$/),
          },
        },
      ]);

      const again = await as(userId, CatalogRpc.publish, ref);
      expect(again).toEqual(published);

      const events = await eventsFor(item.id);
      expect(events.map((e) => [e.type, e.payload.status])).toEqual([
        ['item.created', 'DRAFT'],
        ['item.updated', 'ACTIVE'],
      ]);
      expect(events[1].correlationId).toBe('corr-pub');
    });

    it('moves between ACTIVE and PAUSED, keeping the first publish date', async () => {
      const userId = randomUUID();
      const item = await publishable(userId);
      const ref = { itemId: item.id };

      expect(await failure(as(userId, CatalogRpc.pause, ref))).toEqual({
        code: 'INVALID_STATE',
        message: 'Only a published item can be paused',
      });
      expect((await failure(as(userId, CatalogRpc.unpause, ref))).code).toBe(
        'INVALID_STATE',
      );

      const published = await as(userId, CatalogRpc.publish, ref);
      const paused = await as(userId, CatalogRpc.pause, ref);
      expect(paused.status).toBe('PAUSED');
      expect(await as(userId, CatalogRpc.pause, ref)).toEqual(paused);
      expect(await failure(as(userId, CatalogRpc.publish, ref))).toEqual({
        code: 'INVALID_STATE',
        message: 'Only a draft can be published',
      });

      const unpaused = await as(userId, CatalogRpc.unpause, ref);
      expect(unpaused.status).toBe('ACTIVE');
      expect(unpaused.publishedAt).toBe(published.publishedAt);

      expect((await eventsFor(item.id)).map((e) => e.payload.status)).toEqual([
        'DRAFT',
        'ACTIVE',
        'PAUSED',
        'ACTIVE',
      ]);
    });

    it('re-checks the photos when unpausing', async () => {
      const userId = randomUUID();
      const item = await publishable(userId);
      const ref = { itemId: item.id };
      await as(userId, CatalogRpc.publish, ref);
      await as(userId, CatalogRpc.pause, ref);
      await catalog.dataSource.query(
        `DELETE FROM item_photos WHERE item_id = $1`,
        [item.id],
      );
      expect((await failure(as(userId, CatalogRpc.unpause, ref))).code).toBe(
        'NOT_PUBLISHABLE',
      );
    });
  });

  // --- delete -------------------------------------------------------------------------

  describe('delete', () => {
    it('leaves a minimal tombstone and emits item.deleted once', async () => {
      const userId = randomUUID();
      const item = await publishable(userId);
      const ref = { itemId: item.id };
      await as(userId, CatalogRpc.publish, ref);

      await expect(
        as(userId, CatalogRpc.delete, ref, 'corr-del'),
      ).resolves.toBeUndefined();
      await expect(as(userId, CatalogRpc.delete, ref)).resolves.toBeUndefined();

      const [row] = await catalog.dataSource.query(
        `SELECT status, description, location, location_public, offset_m, title
           FROM items WHERE id = $1`,
        [item.id],
      );
      expect(row).toEqual({
        status: 'DELETED',
        description: '',
        location: null,
        location_public: null,
        offset_m: null,
        title: 'Cordless drill',
      });
      const deleted = (await eventsFor(item.id)).filter(
        (e) => e.type === 'item.deleted',
      );
      expect(deleted).toHaveLength(1);
      expect(deleted[0]).toMatchObject({
        correlationId: 'corr-del',
        payload: { itemId: item.id, lenderId: userId },
      });

      expect((await failure(as(userId, CatalogRpc.getOwn, ref))).code).toBe(
        'NOT_FOUND',
      );
      expect(
        (
          await failure(
            as(userId, CatalogRpc.update, { ...ref, title: 'Back' }),
          )
        ).code,
      ).toBe('NOT_FOUND');
      expect(await as(userId, CatalogRpc.listMine, {})).toEqual([]);
    });
  });

  // --- reads ------------------------------------------------------------------------------

  describe('getOwn and listMine', () => {
    it('lists only the caller’s items, newest first, with photos in order', async () => {
      const userId = randomUUID();
      const older = await create(userId, { title: 'Older' });
      const newer = await create(userId, { title: 'Newer' });
      await create(randomUUID(), { title: 'Someone else' });
      await addPhoto(newer.id, 'READY', 1);
      await addPhoto(newer.id, 'PENDING', 0);

      const mine = await as(userId, CatalogRpc.listMine, {});
      expect(mine.map((i) => i.title)).toEqual(['Newer', 'Older']);
      expect(
        mine[0].photos.map((p) => [p.position, p.status, p.urls === null]),
      ).toEqual([
        [0, 'PENDING', true],
        [1, 'READY', false],
      ]);
      expect(await as(userId, CatalogRpc.getOwn, { itemId: older.id })).toEqual(
        mine[1],
      );
    });
  });

  // --- privacy across everything above ------------------------------------------------------

  it('never puts a location or description in any event', async () => {
    const rows: Array<{ envelope: EventEnvelope }> =
      await catalog.dataSource.query(`SELECT envelope FROM outbox`);
    expect(rows.length).toBeGreaterThan(50);
    for (const { envelope } of rows) {
      const keys = Object.keys(envelope.payload as object);
      for (const forbidden of [
        'location',
        'approximateLocation',
        'description',
      ]) {
        expect(keys).not.toContain(forbidden);
      }
      const text = JSON.stringify(envelope);
      expect(text).not.toContain('Two batteries');
      expect(text).not.toContain('37.98');
    }
  });
});
