import { randomUUID } from 'node:crypto';
import {
  CatalogRpc,
  type GeoPoint,
  type ItemCategory,
  type ItemStatus,
  type PublicItemSummary,
  type RpcErrorBody,
  type SearchItemsRequest,
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
 * Public search and item pages over real TCP, against PostGIS. Items are
 * seeded directly so tests control both points exactly; every test works
 * in its own area, far from the others.
 */
describe('Search and public item pages (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let catalog: CatalogHarness;
  const savedEnv = { ...process.env };
  /** Every public response, for the leak scan at the end. */
  const responses: unknown[] = [];
  /** Every exact point seeded, which must never appear in a response. */
  const exactPoints: GeoPoint[] = [];

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

  let nextArea = 0;
  /** A fresh centre ~1° (≈111 km) from every other test's, beyond any radius. */
  const newArea = (): GeoPoint => ({ lat: 30 + nextArea++, lng: 20.5 });

  async function pointFrom(
    from: GeoPoint,
    metres: number,
    bearingDeg: number,
  ): Promise<GeoPoint> {
    const [row] = await catalog.dataSource.query(
      `SELECT ST_Y(p::geometry) AS lat, ST_X(p::geometry) AS lng FROM (
         SELECT ST_Project(ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography,
                           $3::float8, radians($4::float8)) AS p) q`,
      [from.lat, from.lng, metres, bearingDeg],
    );
    return row;
  }

  async function lender(name = 'Maria', deleted = false): Promise<string> {
    const id = randomUUID();
    await catalog.dataSource.query(
      `INSERT INTO lenders (user_id, display_name, name_updated_at, deleted_at)
       VALUES ($1, $2, now(), $3)`,
      [id, deleted ? null : name, deleted ? new Date() : null],
    );
    return id;
  }

  interface Seed {
    lenderId: string;
    publicAt: GeoPoint;
    /** Defaults to 200 m north-east of the public point (both coordinates differ). */
    exactAt?: GeoPoint;
    status?: ItemStatus;
    title?: string;
    description?: string;
    category?: ItemCategory;
    free?: boolean;
    hourly?: number | null;
    daily?: number | null;
    readyPhotos?: number;
  }

  async function seed(s: Seed): Promise<string> {
    const exact = s.exactAt ?? (await pointFrom(s.publicAt, 200, 45));
    exactPoints.push(exact);
    const status = s.status ?? 'ACTIVE';
    const deleted = status === 'DELETED';
    const free = s.free ?? false;
    const [{ id }] = await catalog.dataSource.query(
      `INSERT INTO items (lender_id, status, title, description, category, free,
                          hourly_cents, daily_cents, deposit_cents,
                          location, location_public, offset_m, offset_bearing,
                          published_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1000,
               CASE WHEN $15 THEN NULL ELSE ST_SetSRID(ST_MakePoint($9::float8, $10::float8), 4326)::geography END,
               CASE WHEN $15 THEN NULL ELSE ST_SetSRID(ST_MakePoint($11::float8, $12::float8), 4326)::geography END,
               CASE WHEN $15 THEN NULL ELSE 200 END,
               CASE WHEN $15 THEN NULL ELSE 180 END,
               $13, $14)
       RETURNING id`,
      [
        s.lenderId,
        status,
        s.title ?? 'Cordless drill',
        deleted ? '' : (s.description ?? 'Two batteries'),
        s.category ?? 'tools',
        free,
        free ? null : (s.hourly ?? null),
        free
          ? null
          : s.daily === undefined && s.hourly === undefined
            ? 500
            : (s.daily ?? null),
        exact.lng,
        exact.lat,
        s.publicAt.lng,
        s.publicAt.lat,
        status === 'DRAFT' ? null : new Date('2026-10-01T10:00:00Z'),
        deleted ? new Date() : null,
        deleted,
      ],
    );
    for (let p = 0; p < (s.readyPhotos ?? 1); p++) {
      await catalog.dataSource.query(
        `INSERT INTO item_photos (item_id, status, position, upload_key, content_type, size_bytes, public_key)
         VALUES ($1, 'READY', $2, $3, 'image/webp', 1000, $4)`,
        [id, p, `incoming/${randomUUID()}`, randomUUID()],
      );
    }
    return id;
  }

  async function search(
    request: Partial<SearchItemsRequest> & { near: GeoPoint },
  ) {
    const response = await catalog.send(CatalogRpc.search, {
      radiusKm: 5,
      ...request,
    });
    responses.push(response);
    return response;
  }

  const ids = (items: PublicItemSummary[]) => items.map((i) => i.id);

  async function failure(promise: Promise<unknown>): Promise<RpcErrorBody> {
    try {
      await promise;
    } catch (err) {
      return err as RpcErrorBody;
    }
    throw new Error('expected the call to fail');
  }

  // --- radius, order and bands --------------------------------------------------

  it('finds items within each radius step, nearest first, with distance bands', async () => {
    const centre = newArea();
    const owner = await lender();
    const at = async (m: number) =>
      seed({ lenderId: owner, publicAt: await pointFrom(centre, m, 45) });
    const [m900, m1500, m4000, m9000, m20000] = [
      await at(900),
      await at(1_500),
      await at(4_000),
      await at(9_000),
      await at(20_000),
    ];
    await at(60_000);

    const within = async (radiusKm: SearchItemsRequest['radiusKm']) =>
      ids((await search({ near: centre, radiusKm })).items);
    expect(await within(1)).toEqual([m900]);
    expect(await within(2)).toEqual([m900, m1500]);
    expect(await within(5)).toEqual([m900, m1500, m4000]);
    expect(await within(10)).toEqual([m900, m1500, m4000, m9000]);
    expect(await within(25)).toEqual([m900, m1500, m4000, m9000, m20000]);
    expect(await within(50)).toEqual([m900, m1500, m4000, m9000, m20000]);

    const { items } = await search({ near: centre, radiusKm: 25 });
    expect(items.map((i) => i.distanceBand)).toEqual([
      'UNDER_1_KM',
      '1_2_KM',
      '2_5_KM',
      '5_10_KM',
      'OVER_10_KM',
    ]);
  });

  it('uses only the public point: never the exact one', async () => {
    const centre = newArea();
    const owner = await lender();
    // Exact point inside 1 km, public point outside: not found.
    const hidden = await seed({
      lenderId: owner,
      exactAt: await pointFrom(centre, 500, 80),
      publicAt: await pointFrom(centre, 1_300, 100),
    });
    // Exact point outside, public point inside: found.
    const shown = await seed({
      lenderId: owner,
      exactAt: await pointFrom(centre, 1_300, 255),
      publicAt: await pointFrom(centre, 500, 285),
    });
    const { items } = await search({ near: centre, radiusKm: 1 });
    expect(ids(items)).toEqual([shown]);
    expect(ids(items)).not.toContain(hidden);

    const [{ lat, lng }] = await catalog.dataSource.query(
      `SELECT ST_Y(location_public::geometry) AS lat, ST_X(location_public::geometry) AS lng
         FROM items WHERE id = $1`,
      [shown],
    );
    expect(items[0].approximateLocation).toEqual({ lat, lng });
  });

  // --- visibility ------------------------------------------------------------------

  it('shows only active items of known, non-deleted lenders', async () => {
    const centre = newArea();
    const near = await pointFrom(centre, 100, 0);
    const owner = await lender();
    const visible = await seed({ lenderId: owner, publicAt: near });
    const hidden = [
      await seed({ lenderId: owner, publicAt: near, status: 'DRAFT' }),
      await seed({ lenderId: owner, publicAt: near, status: 'PAUSED' }),
      await seed({ lenderId: owner, publicAt: near, status: 'DELETED' }),
      // A lender Catalog hasn't heard of yet (D1).
      await seed({ lenderId: randomUUID(), publicAt: near }),
      await seed({ lenderId: await lender('x', true), publicAt: near }),
    ];

    expect(ids((await search({ near: centre })).items)).toEqual([visible]);
    for (const itemId of [...hidden, randomUUID()]) {
      expect(
        await failure(catalog.send(CatalogRpc.getPublic, { itemId })),
      ).toEqual({ code: 'NOT_FOUND', message: 'Item not found' });
    }
  });

  // --- text and filters ------------------------------------------------------------

  it('matches Greek without accents or case, English stems, and both at once', async () => {
    const centre = newArea();
    const near = await pointFrom(centre, 300, 10);
    const owner = await lender();
    const drill = await seed({
      lenderId: owner,
      publicAt: near,
      title: 'Δράπανο μπαταρίας',
      description: 'Cordless, with two batteries',
    });
    const ladder = await seed({
      lenderId: owner,
      publicAt: near,
      title: 'Σκάλα αλουμινίου',
      description: 'Folding ladder',
      category: 'diy-ladders',
    });
    const q = async (text: string) =>
      ids((await search({ near: centre, q: text })).items).sort();

    expect(await q('δραπανο')).toEqual([drill]);
    expect(await q('ΔΡΆΠΑΝΑ')).toEqual([drill]);
    expect(await q('battery')).toEqual([drill]);
    expect(await q('ladders')).toEqual([ladder]);
    expect(await q('σκάλα folding')).toEqual([ladder]);
    expect(await q('lawnmower')).toEqual([]);
    // Blank text is no text.
    expect(await q('   ')).toEqual([drill, ladder].sort());
    // Search syntax is just text, never an error.
    expect(await q('"drill" -ladder OR (')).toEqual(expect.any(Array));
  });

  it('filters by category, free only, and a maximum price that includes free items', async () => {
    const centre = newArea();
    const near = await pointFrom(centre, 250, 120);
    const owner = await lender();
    const free = await seed({ lenderId: owner, publicAt: near, free: true });
    const cheap = await seed({ lenderId: owner, publicAt: near, daily: 400 });
    const pricey = await seed({ lenderId: owner, publicAt: near, daily: 600 });
    const hourlyOnly = await seed({
      lenderId: owner,
      publicAt: near,
      hourly: 100,
      daily: null,
    });
    const tent = await seed({
      lenderId: owner,
      publicAt: near,
      title: 'Tent',
      category: 'camping',
      daily: 300,
    });
    const found = async (filters: Partial<SearchItemsRequest>) =>
      ids((await search({ near: centre, ...filters })).items).sort();

    expect(await found({ category: 'camping' })).toEqual([tent]);
    expect(await found({ freeOnly: true })).toEqual([free]);
    // ADR-0012: free items match a price limit.
    expect(await found({ maxPriceCents: 500, priceUnit: 'DAY' })).toEqual(
      [free, cheap, tent].sort(),
    );
    expect(await found({ maxPriceCents: 100, priceUnit: 'HOUR' })).toEqual(
      [free, hourlyOnly].sort(),
    );
    expect(
      await found({ maxPriceCents: 500, priceUnit: 'DAY', category: 'tools' }),
    ).toEqual([free, cheap].sort());
    expect(await found({})).toContain(pricey);
  });

  // --- paging -----------------------------------------------------------------------

  it('pages through every result once, in order, including ties', async () => {
    const centre = newArea();
    const owner = await lender();
    const all: string[] = [];
    for (let i = 0; i < 19; i++) {
      // Groups of three share one public point (as items at one home do).
      const at = await pointFrom(centre, 100 + Math.floor(i / 3) * 400, 200);
      all.push(await seed({ lenderId: owner, publicAt: at, readyPhotos: 0 }));
    }
    const full = ids((await search({ near: centre, limit: 50 })).items);
    expect(full.sort()).toEqual([...all].sort());

    const paged: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await search({ near: centre, limit: 7, cursor });
      paged.push(...ids(page.items));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(paged).toEqual(
      ids((await search({ near: centre, limit: 50 })).items),
    );
    expect(new Set(paged).size).toBe(19);
  });

  it('returns no cursor on the last page and no cover without a processed photo', async () => {
    const centre = newArea();
    const owner = await lender();
    await seed({
      lenderId: owner,
      publicAt: await pointFrom(centre, 100, 0),
      readyPhotos: 0,
    });
    const page = await search({ near: centre });
    expect(page.nextCursor).toBeNull();
    expect(page.items[0].coverPhoto).toBeNull();
  });

  it.each([
    ['garbage', 'not-a-cursor'],
    [
      'valid base64 of something else',
      Buffer.from('{"d":-5}').toString('base64url'),
    ],
  ])('rejects a %s cursor', async (_, cursor) => {
    expect(await failure(search({ near: newArea(), cursor }))).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Invalid fields: cursor',
    });
  });

  // --- input ---------------------------------------------------------------------------

  it.each([
    ['a radius that is not a step', { radiusKm: 3 }],
    ['no point', { near: undefined }],
    ['a latitude past the pole', { near: { lat: 91, lng: 0 } }],
    ['a price without a unit', { maxPriceCents: 500 }],
    ['a unit without a price', { priceUnit: 'DAY' }],
    ['a page over the maximum', { limit: 51 }],
    ['text over the maximum', { q: 'a'.repeat(101) }],
    ['an unknown field', { sort: 'price' }],
  ])('rejects %s, without echoing the point', async (_, overrides) => {
    const near = { lat: 37.123456789, lng: 23.987654321 };
    const error = await failure(
      catalog.send(CatalogRpc.search, { near, radiusKm: 5, ...overrides }),
    );
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).not.toMatch(/37\.12|23\.98/);
  });

  // --- the public item page ---------------------------------------------------------------

  it('shows an item page with processed photos in order and the lender’s name', async () => {
    const centre = newArea();
    const owner = await lender('Eleni');
    const itemId = await seed({
      lenderId: owner,
      publicAt: await pointFrom(centre, 400, 300),
      readyPhotos: 2,
    });
    await catalog.dataSource.query(
      `INSERT INTO item_photos (item_id, status, position, upload_key, content_type, size_bytes)
       VALUES ($1, 'PENDING', 2, $2, 'image/jpeg', 1000)`,
      [itemId, `incoming/${randomUUID()}`],
    );
    const page = await catalog.send(CatalogRpc.getPublic, { itemId });
    responses.push(page);
    expect(page).toEqual({
      id: itemId,
      title: 'Cordless drill',
      description: 'Two batteries',
      category: 'tools',
      pricing: { free: false, dailyCents: 500 },
      depositCents: 1000,
      photos: [
        { id: expect.any(String), urls: expect.any(Object) },
        { id: expect.any(String), urls: expect.any(Object) },
      ],
      lender: { id: owner, displayName: 'Eleni' },
      approximateLocation: expect.any(Object),
      publishedAt: '2026-10-01T10:00:00.000Z',
    });
    expect(page.photos[0].urls.small).toMatch(
      new RegExp(`^${TEST_PHOTOS_BASE_URL}/items/[0-9a-f-]{36}/320\\.webp$`),
    );
  });

  // --- search as you type (9b) -------------------------------------------------------------

  describe('suggest', () => {
    async function suggest(near: GeoPoint, q: string, radiusKm = 5) {
      const response = await catalog.send(CatalogRpc.suggest, {
        near,
        radiusKm,
        q,
      });
      responses.push(response);
      return response.suggestions;
    }

    it('matches what has been typed so far, in Greek and English', async () => {
      const centre = newArea();
      const owner = await lender();
      const near = await pointFrom(centre, 300, 30);
      const drill = await seed({
        lenderId: owner,
        publicAt: near,
        title: 'Δράπανο μπαταρίας',
        description: 'Cordless drill, two batteries',
      });
      const ladder = await seed({
        lenderId: owner,
        publicAt: near,
        title: 'Σκάλα αλουμινίου',
        description: '',
      });
      const typed = async (q: string) =>
        (await suggest(centre, q)).map((s) => s.id).sort();

      for (const q of [
        'δρ',
        'δραπ',
        'ΔΡΆΠ',
        'δράπανο',
        'μπαταρια',
        'dri',
        'drills',
        'batter',
      ]) {
        expect(await typed(q)).toEqual([drill]);
      }
      for (const q of ['σκ', 'σκαλα', 'σκάλες', 'αλουμ']) {
        expect(await typed(q)).toEqual([ladder]);
      }
      // Every word must match.
      expect(await typed('δραπ σκαλ')).toEqual([]);
      expect(await typed('δραπ batt')).toEqual([drill]);
      expect(await typed('xyz')).toEqual([]);
    });

    it('returns the nearest five visible items, with thumbnails and bands', async () => {
      const centre = newArea();
      const owner = await lender();
      const byDistance: string[] = [];
      for (const m of [700, 100, 1_500, 300, 2_500, 900]) {
        byDistance.push(
          await seed({
            lenderId: owner,
            publicAt: await pointFrom(centre, m, 60),
          }),
        );
      }
      await seed({
        lenderId: owner,
        publicAt: await pointFrom(centre, 50, 60),
        status: 'PAUSED',
      });
      await seed({
        lenderId: owner,
        publicAt: await pointFrom(centre, 8_000, 60),
      });

      const suggestions = await suggest(centre, 'cord', 5);
      // 100, 300, 700, 900 and 1,500 m.
      expect(suggestions.map((s) => s.id)).toEqual([
        byDistance[1],
        byDistance[3],
        byDistance[0],
        byDistance[5],
        byDistance[2],
      ]);
      expect(suggestions[0]).toEqual({
        id: byDistance[1],
        title: 'Cordless drill',
        thumbnailUrl: expect.stringMatching(
          new RegExp(
            `^${TEST_PHOTOS_BASE_URL}/items/[0-9a-f-]{36}/320\\.webp$`,
          ),
        ),
        distanceBand: 'UNDER_1_KM',
      });
      expect(suggestions[4].distanceBand).toBe('1_2_KM');
    });

    it('treats punctuation and search syntax as plain separators', async () => {
      const centre = newArea();
      const owner = await lender();
      const drill = await seed({
        lenderId: owner,
        publicAt: await pointFrom(centre, 200, 0),
      });
      expect((await suggest(centre, 'dr:* | !(')).map((s) => s.id)).toEqual([
        drill,
      ]);
      expect(await suggest(centre, '!!!')).toEqual([]);
    });

    it.each([
      ['one character', { q: 'δ' }],
      ['blank text', { q: '     ' }],
      ['text over the maximum', { q: 'a'.repeat(101) }],
      ['a radius that is not a step', { q: 'drill', radiusKm: 4 }],
      ['no point', { q: 'drill', near: undefined }],
    ])('rejects %s', async (_, overrides) => {
      const error = await failure(
        catalog.send(CatalogRpc.suggest, {
          near: { lat: 37.123456789, lng: 23.987654321 },
          radiusKm: 5,
          ...overrides,
        }),
      );
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.message).not.toMatch(/37\.12|23\.98/);
    });
  });

  // --- similar items (9c) -----------------------------------------------------------------

  describe('similar', () => {
    async function similar(itemId: string): Promise<PublicItemSummary[]> {
      const response = await catalog.send(CatalogRpc.similar, { itemId });
      responses.push(response);
      return response.items;
    }

    it('ranks other lenders’ items in the same category by shared title words, then distance', async () => {
      const centre = newArea();
      const [me, a, b] = [await lender(), await lender('A'), await lender('B')];
      const base = await seed({
        lenderId: me,
        publicAt: centre,
        title: 'Cordless drill Bosch',
      });
      const at = (m: number) => pointFrom(centre, m, 150);
      const twoWords = await seed({
        lenderId: a,
        publicAt: await at(3_000),
        title: 'Bosch cordless screwdriver',
      });
      const oneWordFar = await seed({
        lenderId: b,
        publicAt: await at(1_500),
        title: 'Hammer drill',
      });
      const oneWordNear = await seed({
        lenderId: a,
        publicAt: await at(500),
        title: 'Drill bits set',
      });
      const noWords = await seed({
        lenderId: b,
        publicAt: await at(100),
        title: 'Angle grinder',
      });
      // Left out: my own item, another category, too far, not visible.
      await seed({
        lenderId: me,
        publicAt: await at(50),
        title: 'Cordless drill',
      });
      await seed({
        lenderId: a,
        publicAt: await at(50),
        title: 'Cordless drill tent',
        category: 'camping',
      });
      await seed({
        lenderId: a,
        publicAt: await at(12_000),
        title: 'Cordless drill',
      });
      await seed({
        lenderId: a,
        publicAt: await at(50),
        title: 'Cordless drill',
        status: 'PAUSED',
      });

      const items = await similar(base);
      expect(items.map((i) => i.id)).toEqual([
        twoWords,
        oneWordNear,
        oneWordFar,
        noWords,
      ]);
      expect(items.map((i) => i.distanceBand)).toEqual([
        '2_5_KM',
        'UNDER_1_KM',
        '1_2_KM',
        'UNDER_1_KM',
      ]);
      expect(items[0].lender).toEqual({ id: a, displayName: 'A' });
    });

    it('returns at most 8, and an empty list when nothing is similar', async () => {
      const centre = newArea();
      const base = await seed({ lenderId: await lender(), publicAt: centre });
      expect(await similar(base)).toEqual([]);

      const other = await lender('Other');
      for (let i = 0; i < 10; i++) {
        await seed({
          lenderId: other,
          publicAt: await pointFrom(centre, 100 + i * 50, 0),
        });
      }
      expect(await similar(base)).toHaveLength(8);
    });

    it('answers NOT_FOUND exactly when the item page would', async () => {
      const centre = newArea();
      const owner = await lender();
      for (const status of ['DRAFT', 'PAUSED', 'DELETED'] as const) {
        const itemId = await seed({
          lenderId: owner,
          publicAt: centre,
          status,
        });
        expect(
          await failure(catalog.send(CatalogRpc.similar, { itemId })),
        ).toEqual({ code: 'NOT_FOUND', message: 'Item not found' });
      }
      expect(
        (await failure(catalog.send(CatalogRpc.similar, { itemId: 'nope' })))
          .code,
      ).toBe('VALIDATION_FAILED');
    });
  });

  // --- privacy across everything above ----------------------------------------------------

  it('never returns an exact point or an offset', () => {
    expect(responses.length).toBeGreaterThan(20);
    const text = JSON.stringify(responses);
    expect(text).not.toMatch(/"location"|offset/i);
    for (const { lat, lng } of exactPoints) {
      expect(text).not.toContain(String(lat));
      expect(text).not.toContain(String(lng));
    }
  });
});
