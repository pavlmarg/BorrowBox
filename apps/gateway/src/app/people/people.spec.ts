import Redis from 'ioredis';
import { CatalogRpc, IdentityRpc } from '@borrowbox/contracts';
import { startRedis, type TestRedis } from '@borrowbox/testing';
import { FakeCatalog, FakeIdentity } from '../../testing/fake-service';
import {
  startGateway,
  type GatewayHarness,
} from '../../testing/gateway-harness';

/**
 * Public profiles and name search (ADR-0025) on the real gateway, against
 * scripted Identity and Catalog over real TCP.
 */
describe('People routes (integration)', () => {
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

  const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const profile = {
    id: USER,
    displayName: 'Maria',
    photo: null,
    bio: 'After 9, please',
    memberSince: '2026-10-01T10:00:00.000Z',
  };

  it('shows a public profile without any token', async () => {
    identity.on(IdentityRpc.getPublicProfile, () => profile);
    await gw.http().get(`/api/users/${USER}`).expect(200, profile);
    const [call] = identity.callsTo(IdentityRpc.getPublicProfile);
    expect(call.message.data).toEqual({ userId: USER });
    expect(call.message.accessToken).toBeUndefined();
  });

  it('answers 404 for an unknown account and 400 for a malformed id', async () => {
    identity.fail(IdentityRpc.getPublicProfile, {
      code: 'NOT_FOUND',
      message: 'Profile not found',
    });
    const res = await gw.http().get(`/api/users/${USER}`).expect(404);
    expect(res.body).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Profile not found',
    });
    await gw.http().get('/api/users/nope').expect(400);
    await gw.http().get('/api/users/nope/items').expect(400);
    expect(identity.callsTo(IdentityRpc.getPublicProfile)).toHaveLength(1);
    expect(catalog.calls).toHaveLength(0);
  });

  it('lists a person’s items from Catalog', async () => {
    const items = {
      items: [
        {
          id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
          title: 'Ladder',
          category: 'tools',
          pricing: { free: true },
          depositCents: 0,
          coverPhoto: null,
        },
      ],
    };
    catalog.on(CatalogRpc.lenderItems, () => items);
    await gw.http().get(`/api/users/${USER}/items`).expect(200, items);
    expect(catalog.callsTo(CatalogRpc.lenderItems)[0].message.data).toEqual({
      lenderId: USER,
    });
  });

  it('finds people with the text in the body, from 2 characters', async () => {
    catalog.on(CatalogRpc.suggestPeople, () => ({ people: [] }));
    await gw
      .http()
      .post('/api/people/suggest')
      .send({ q: ' μαρ ' })
      .expect(200, { people: [] });
    expect(catalog.callsTo(CatalogRpc.suggestPeople)[0].message.data).toEqual({
      q: 'μαρ',
    });
    for (const body of [
      { q: 'μ' },
      { q: 'α'.repeat(101) },
      {},
      { q: 'ok', near: 1 },
    ]) {
      await gw.http().post('/api/people/suggest').send(body).expect(400);
    }
    expect(catalog.callsTo(CatalogRpc.suggestPeople)).toHaveLength(1);
  });

  it('allows 300 name searches a minute per IP', async () => {
    catalog.on(CatalogRpc.suggestPeople, () => ({ people: [] }));
    const send = () => gw.http().post('/api/people/suggest').send({ q: 'ma' });
    for (let i = 0; i < 300; i++) await send().expect(200);
    const res = await send().expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });
});
