import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  CatalogRpc,
  type CatalogErrorCode,
  type CatalogRpcPattern,
} from '@borrowbox/contracts';
import { startRedis, type TestRedis } from '@borrowbox/testing';
import { FakeCatalog, FakeIdentity } from '../../testing/fake-service';
import {
  startGateway,
  type GatewayHarness,
} from '../../testing/gateway-harness';

/**
 * Catalog's HTTP API on the real gateway (guards, validation, rate limits,
 * error mapping) against a scripted Catalog over real TCP.
 */
describe('Catalog routes (integration)', () => {
  let redis: TestRedis;
  let identity: FakeIdentity;
  let catalog: FakeCatalog;
  let gw: GatewayHarness;
  let redisClient: Redis;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    redis = await startRedis();
    identity = new FakeIdentity();
    catalog = new FakeCatalog();
    await Promise.all([identity.start(), catalog.start()]);
    gw = await startGateway({
      redisUrl: redis.url,
      identityPort: identity.port,
      catalogPort: catalog.port,
    });
    redisClient = new Redis(redis.url);
  });

  afterAll(async () => {
    await gw?.close();
    await Promise.all([identity?.stop(), catalog?.stop()]);
    await redisClient?.quit();
    process.env = savedEnv;
    await redis?.stop();
  });

  beforeEach(async () => {
    catalog.reset();
    identity.reset();
    await redisClient.flushall(); // rate-limit counters
  });

  const ITEM = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const PHOTO = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const NEAR = { lat: 37.9838, lng: 23.7275 };
  const echo = (m: { data: unknown }) => ({ echoed: m.data });

  // --- public routes ------------------------------------------------------------

  describe('public', () => {
    it('searches with the point in the body, without any token', async () => {
      catalog.on(CatalogRpc.search, () => ({ items: [], nextCursor: null }));
      const body = { near: NEAR, radiusKm: 5, q: 'δράπανο', freeOnly: false };
      const res = await gw
        .http()
        .post('/api/items/search')
        .send(body)
        .expect(200);
      expect(res.body).toEqual({ items: [], nextCursor: null });
      const [call] = catalog.callsTo(CatalogRpc.search);
      expect(call.message.data).toEqual(body);
      expect(call.message.accessToken).toBeUndefined();
      expect(call.message.correlationId).toEqual(expect.any(String));
    });

    it.each([
      ['a radius that is not a step', { near: NEAR, radiusKm: 3 }],
      ['no point', { radiusKm: 5 }],
      [
        'a price without a unit',
        { near: NEAR, radiusKm: 5, maxPriceCents: 500 },
      ],
      ['an unknown field', { near: NEAR, radiusKm: 5, sort: 'price' }],
      [
        'text over 100 characters',
        { near: NEAR, radiusKm: 5, q: 'α'.repeat(101) },
      ],
    ])(
      'rejects a search with %s before calling Catalog, never echoing the point',
      async (_, body) => {
        const res = await gw
          .http()
          .post('/api/items/search')
          .send(body)
          .expect(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
        expect(JSON.stringify(res.body)).not.toMatch(/37\.98|23\.72/);
        expect(catalog.calls).toHaveLength(0);
      },
    );

    it('suggests from 2 characters', async () => {
      catalog.on(CatalogRpc.suggest, () => ({ suggestions: [] }));
      await gw
        .http()
        .post('/api/items/suggest')
        .send({ near: NEAR, radiusKm: 2, q: 'δρ' })
        .expect(200, { suggestions: [] });
      await gw
        .http()
        .post('/api/items/suggest')
        .send({ near: NEAR, radiusKm: 2, q: 'δ' })
        .expect(400);
      expect(catalog.callsTo(CatalogRpc.suggest)).toHaveLength(1);
    });

    it('allows 300 suggestions a minute per IP, more than the default 120', async () => {
      catalog.on(CatalogRpc.suggest, () => ({ suggestions: [] }));
      const send = () =>
        gw
          .http()
          .post('/api/items/suggest')
          .send({ near: NEAR, radiusKm: 2, q: 'dr' });
      for (let i = 0; i < 300; i++) expect((await send()).status).toBe(200);
      const limited = await send();
      expect(limited.status).toBe(429);
      expect(limited.body.code).toBe('RATE_LIMITED');
    });

    it('serves an item page and its similar items by id', async () => {
      catalog
        .on(CatalogRpc.getPublic, echo)
        .on(CatalogRpc.similar, () => ({ items: [] }));
      const page = await gw.http().get(`/api/items/${ITEM}`).expect(200);
      expect(page.body).toEqual({ echoed: { itemId: ITEM } });
      await gw
        .http()
        .get(`/api/items/${ITEM}/similar`)
        .expect(200, { items: [] });
      expect(catalog.callsTo(CatalogRpc.similar)[0].message.data).toEqual({
        itemId: ITEM,
      });
    });

    it('rejects a malformed id without calling Catalog', async () => {
      const res = await gw.http().get('/api/items/not-a-uuid').expect(400);
      // Nest's own checks answer generically, never echoing the input.
      expect(res.body).toEqual({
        statusCode: 400,
        code: 'MALFORMED_REQUEST',
        message: 'Malformed request',
      });
      expect(catalog.calls).toHaveLength(0);
    });
  });

  // --- the lender's own items ------------------------------------------------------

  const routes: Array<{
    method: 'get' | 'post' | 'patch' | 'put' | 'delete';
    path: string;
    body?: object;
    pattern: CatalogRpcPattern;
    data: object;
    status: number;
  }> = [
    {
      method: 'get',
      path: '/api/me/items',
      pattern: CatalogRpc.listMine,
      data: {},
      status: 200,
    },
    {
      method: 'post',
      path: '/api/me/items',
      body: {
        itemId: ITEM,
        title: '  Cordless drill ',
        category: 'tools',
        pricing: { free: false, dailyCents: 500 },
        depositCents: 2000,
      },
      pattern: CatalogRpc.create,
      data: {
        itemId: ITEM,
        title: 'Cordless drill',
        category: 'tools',
        pricing: { free: false, dailyCents: 500 },
        depositCents: 2000,
      },
      status: 201,
    },
    {
      method: 'get',
      path: `/api/me/items/${ITEM}`,
      pattern: CatalogRpc.getOwn,
      data: { itemId: ITEM },
      status: 200,
    },
    {
      method: 'patch',
      path: `/api/me/items/${ITEM}`,
      body: { title: 'Hammer drill' },
      pattern: CatalogRpc.update,
      data: { itemId: ITEM, title: 'Hammer drill' },
      status: 200,
    },
    {
      method: 'delete',
      path: `/api/me/items/${ITEM}`,
      pattern: CatalogRpc.delete,
      data: { itemId: ITEM },
      status: 204,
    },
    {
      method: 'put',
      path: `/api/me/items/${ITEM}/location`,
      body: { location: NEAR },
      pattern: CatalogRpc.setLocation,
      data: { itemId: ITEM, location: NEAR },
      status: 200,
    },
    {
      method: 'post',
      path: `/api/me/items/${ITEM}/publish`,
      pattern: CatalogRpc.publish,
      data: { itemId: ITEM },
      status: 200,
    },
    {
      method: 'post',
      path: `/api/me/items/${ITEM}/pause`,
      pattern: CatalogRpc.pause,
      data: { itemId: ITEM },
      status: 200,
    },
    {
      method: 'post',
      path: `/api/me/items/${ITEM}/unpause`,
      pattern: CatalogRpc.unpause,
      data: { itemId: ITEM },
      status: 200,
    },
    {
      method: 'post',
      path: `/api/me/items/${ITEM}/photos`,
      body: { contentType: 'image/avif', sizeBytes: 1234 },
      pattern: CatalogRpc.createPhotoUpload,
      data: { itemId: ITEM, contentType: 'image/avif', sizeBytes: 1234 },
      status: 201,
    },
    {
      method: 'post',
      path: `/api/me/items/${ITEM}/photos/${PHOTO}/confirm`,
      pattern: CatalogRpc.confirmPhoto,
      data: { itemId: ITEM, photoId: PHOTO },
      status: 200,
    },
    {
      method: 'delete',
      path: `/api/me/items/${ITEM}/photos/${PHOTO}`,
      pattern: CatalogRpc.deletePhoto,
      data: { itemId: ITEM, photoId: PHOTO },
      status: 204,
    },
    {
      method: 'put',
      path: `/api/me/items/${ITEM}/photos/order`,
      body: { photoIds: [PHOTO] },
      pattern: CatalogRpc.reorderPhotos,
      data: { itemId: ITEM, photoIds: [PHOTO] },
      status: 200,
    },
  ];

  describe('my items', () => {
    it.each(routes)(
      '$method $path forwards to $pattern with the caller’s token',
      async (route) => {
        catalog.on(route.pattern, echo);
        const userId = randomUUID();
        const bearer = await gw.bearer(userId);
        let req = gw
          .http()
          [route.method](route.path)
          .set('Authorization', bearer);
        if (route.body) req = req.send(route.body);
        const res = await req.expect(route.status);
        if (route.status !== 204)
          expect(res.body).toEqual({ echoed: route.data });

        const [call] = catalog.callsTo(route.pattern);
        expect(call.message.data).toEqual(route.data);
        // Forwarded as is, so Catalog verifies it again.
        expect(`Bearer ${call.message.accessToken}`).toBe(bearer);
      },
    );

    it.each(routes)(
      '$method $path needs a valid token and never calls Catalog otherwise',
      async (route) => {
        const without = gw.http()[route.method](route.path);
        expect(
          (await (route.body ? without.send(route.body) : without)).status,
        ).toBe(401);
        const forged = gw
          .http()
          [route.method](route.path)
          .set('Authorization', await gw.forgedBearer());
        expect(
          (await (route.body ? forged.send(route.body) : forged)).status,
        ).toBe(401);
        expect(catalog.calls).toHaveLength(0);
      },
    );

    it("can't override the item in the path from the body", async () => {
      const res = await gw
        .http()
        .patch(`/api/me/items/${ITEM}`)
        .set('Authorization', await gw.bearer())
        .send({ itemId: randomUUID(), title: 'Other' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(catalog.calls).toHaveLength(0);
    });

    it.each([
      ['a three-character emoji title', { title: '🔨🪚🛠' }, 201],
      ['a two-character emoji title', { title: '🔨🪚' }, 400],
      ['free with a rate', { pricing: { free: true, dailyCents: 500 } }, 400],
      [
        'an unknown pricing field',
        { pricing: { free: true, yearlyCents: 1 } },
        400,
      ],
      ['a fractional deposit', { depositCents: 10.5 }, 400],
      ['an SVG photo type', null, 400],
    ])('validates %s like Catalog does', async (_, overrides, status) => {
      catalog
        .on(CatalogRpc.create, echo)
        .on(CatalogRpc.createPhotoUpload, echo);
      const bearer = await gw.bearer();
      const res = overrides
        ? await gw
            .http()
            .post('/api/me/items')
            .set('Authorization', bearer)
            .send({
              itemId: ITEM,
              title: 'Cordless drill',
              category: 'tools',
              pricing: { free: true },
              depositCents: 0,
              ...overrides,
            })
        : await gw
            .http()
            .post(`/api/me/items/${ITEM}/photos`)
            .set('Authorization', bearer)
            .send({ contentType: 'image/svg+xml', sizeBytes: 100 });
      expect(res.status).toBe(status);
    });

    it.each<[CatalogErrorCode, number]>([
      ['VALIDATION_FAILED', 400],
      ['UNAUTHENTICATED', 401],
      ['NOT_FOUND', 404],
      ['NOT_PUBLISHABLE', 409],
      ['INVALID_STATE', 409],
      ['ITEM_LIMIT_REACHED', 409],
      ['PHOTO_LIMIT_REACHED', 409],
      ['INTERNAL', 500],
    ])('maps Catalog’s %s to %d with its message', async (code, status) => {
      catalog.fail(CatalogRpc.publish, { code, message: `Because ${code}` });
      const res = await gw
        .http()
        .post(`/api/me/items/${ITEM}/publish`)
        .set('Authorization', await gw.bearer())
        .expect(status);
      expect(res.body).toEqual({
        statusCode: status,
        code,
        message: `Because ${code}`,
      });
    });

    it('answers 503 when Catalog does not respond in time', async () => {
      catalog.on(CatalogRpc.listMine, () => new Promise(() => undefined));
      const res = await gw
        .http()
        .get('/api/me/items')
        .set('Authorization', await gw.bearer())
        .expect(503);
      expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(res.body.message).not.toMatch(/catalog/i);
    });
  });
});
