import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { BookingsRpc, MessagingRpc } from '@borrowbox/contracts';
import { startRedis, type TestRedis } from '@borrowbox/testing';
import {
  FakeBookings,
  FakeCatalog,
  FakeIdentity,
} from '../../testing/fake-service';
import {
  startGateway,
  type GatewayHarness,
} from '../../testing/gateway-harness';

/**
 * Bookings' and Messaging's HTTP API on the real gateway (guards,
 * validation, per-user limits, error mapping) against a scripted Bookings
 * over real TCP.
 */
describe('Booking and chat routes (integration)', () => {
  let redis: TestRedis;
  let identity: FakeIdentity;
  let catalog: FakeCatalog;
  let bookings: FakeBookings;
  let gw: GatewayHarness;
  let redisClient: Redis;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    redis = await startRedis();
    identity = new FakeIdentity();
    catalog = new FakeCatalog();
    bookings = new FakeBookings();
    await Promise.all([identity.start(), catalog.start(), bookings.start()]);
    gw = await startGateway({
      redisUrl: redis.url,
      identityPort: identity.port,
      catalogPort: catalog.port,
      bookingsPort: bookings.port,
    });
    redisClient = new Redis(redis.url);
  });

  afterAll(async () => {
    await gw?.close();
    await Promise.all([identity?.stop(), catalog?.stop(), bookings?.stop()]);
    await redisClient?.quit();
    process.env = savedEnv;
    await redis?.stop();
  });

  beforeEach(async () => {
    bookings.reset();
    await redisClient.flushall(); // rate-limit counters
  });

  const ITEM = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const BOOKING = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const CONVERSATION = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const START = '2026-11-02T10:00:00.000Z';
  const END = '2026-11-02T13:00:00.000Z';
  const echo = (m: { data: unknown }) => ({ echoed: m.data });

  describe('public queries', () => {
    it('quotes a period without a token', async () => {
      bookings.on(BookingsRpc.quote, echo);
      const res = await gw
        .http()
        .get(`/api/items/${ITEM}/quote`)
        .query({ start: START, end: END })
        .expect(200);
      expect(res.body).toEqual({
        echoed: { itemId: ITEM, start: START, end: END },
      });
      expect(
        bookings.callsTo(BookingsRpc.quote)[0].message.accessToken,
      ).toBeUndefined();
    });

    it('rejects a malformed period before calling Bookings', async () => {
      await gw
        .http()
        .get(`/api/items/${ITEM}/quote`)
        .query({ start: 'tomorrow', end: END })
        .expect(400);
      // A time without an offset would be read in the server's time zone.
      await gw
        .http()
        .get(`/api/items/${ITEM}/quote`)
        .query({ start: '2026-11-02T10:00:00', end: END })
        .expect(400);
      expect(bookings.calls).toEqual([]);
    });

    it('maps INVALID_PERIOD to 400 and NOT_FOUND to 404', async () => {
      bookings.fail(BookingsRpc.quote, {
        code: 'INVALID_PERIOD',
        message: 'Bookings start and end on the hour',
      });
      const res = await gw
        .http()
        .get(`/api/items/${ITEM}/quote`)
        .query({ start: START, end: END })
        .expect(400);
      expect(res.body).toEqual({
        statusCode: 400,
        code: 'INVALID_PERIOD',
        message: 'Bookings start and end on the hour',
      });
      bookings.fail(BookingsRpc.busyPeriods, {
        code: 'NOT_FOUND',
        message: 'Item not found',
      });
      await gw.http().get(`/api/items/${ITEM}/busy`).expect(404);
    });
  });

  describe('bookings', () => {
    it('needs a sign-in', async () => {
      await gw
        .http()
        .post('/api/bookings')
        .send({ bookingId: BOOKING, itemId: ITEM, start: START, end: END })
        .expect(401);
      await gw.http().get('/api/me/bookings?role=RENTER').expect(401);
      expect(bookings.calls).toEqual([]);
    });

    it('forwards a request with the token and answers 201', async () => {
      bookings.on(BookingsRpc.request, echo);
      const body = { bookingId: BOOKING, itemId: ITEM, start: START, end: END };
      const res = await gw
        .http()
        .post('/api/bookings')
        .set('Authorization', await gw.bearer())
        .send(body)
        .expect(201);
      expect(res.body).toEqual({ echoed: body });
      expect(
        bookings.callsTo(BookingsRpc.request)[0].message.accessToken,
      ).toEqual(expect.any(String));
    });

    it.each([
      ['SLOT_TAKEN', 409],
      ['DUPLICATE_REQUEST', 409],
      ['REQUEST_LIMIT_REACHED', 409],
      ['OWN_ITEM', 409],
      ['EMAIL_NOT_VERIFIED', 403],
      ['PAYOUTS_NOT_SET_UP', 409],
    ] as const)('maps %s to %i', async (code, status) => {
      bookings.fail(BookingsRpc.request, { code, message: 'No' });
      const res = await gw
        .http()
        .post('/api/bookings')
        .set('Authorization', await gw.bearer())
        .send({ bookingId: BOOKING, itemId: ITEM, start: START, end: END })
        .expect(status);
      expect(res.body.code).toBe(code);
    });

    it('allows 30 requests per user per hour, whatever the IP', async () => {
      bookings.on(BookingsRpc.request, echo);
      const userId = randomUUID();
      const send = async () =>
        gw
          .http()
          .post('/api/bookings')
          .set('Authorization', await gw.bearer(userId))
          .send({
            bookingId: randomUUID(),
            itemId: ITEM,
            start: START,
            end: END,
          });
      for (let i = 0; i < 30; i++) expect((await send()).status).toBe(201);
      const refused = await send();
      expect(refused.status).toBe(429);
      expect(refused.body.code).toBe('RATE_LIMITED');
      // Someone else isn't affected.
      const other = await gw
        .http()
        .post('/api/bookings')
        .set('Authorization', await gw.bearer())
        .send({
          bookingId: randomUUID(),
          itemId: ITEM,
          start: START,
          end: END,
        });
      expect(other.status).toBe(201);
    });

    it('accepts, declines and cancels with 200', async () => {
      for (const [path, pattern] of [
        ['accept', BookingsRpc.accept],
        ['decline', BookingsRpc.decline],
        ['cancel', BookingsRpc.cancel],
      ] as const) {
        bookings.on(pattern, echo);
        const res = await gw
          .http()
          .post(`/api/bookings/${BOOKING}/${path}`)
          .set('Authorization', await gw.bearer())
          .expect(200);
        expect(res.body).toEqual({ echoed: { bookingId: BOOKING } });
      }
    });

    it('lists bookings with comma-separated statuses', async () => {
      bookings.on(BookingsRpc.listMine, echo);
      const res = await gw
        .http()
        .get('/api/me/bookings')
        .query({ role: 'LENDER', statuses: 'REQUESTED,ACCEPTED', limit: '5' })
        .set('Authorization', await gw.bearer())
        .expect(200);
      expect(res.body).toEqual({
        echoed: {
          role: 'LENDER',
          statuses: ['REQUESTED', 'ACCEPTED'],
          limit: 5,
        },
      });
      await gw
        .http()
        .get('/api/me/bookings')
        .query({ role: 'LENDER', statuses: 'NOPE' })
        .set('Authorization', await gw.bearer())
        .expect(400);
    });
  });

  describe('conversations and offers', () => {
    it('sends a trimmed message and rejects an empty or over-long one', async () => {
      bookings.on(MessagingRpc.send, echo);
      const messageId = randomUUID();
      const res = await gw
        .http()
        .post(`/api/conversations/${CONVERSATION}/messages`)
        .set('Authorization', await gw.bearer())
        .send({ messageId, text: '  hello  ' })
        .expect(201);
      expect(res.body).toEqual({
        echoed: { messageId, text: 'hello', conversationId: CONVERSATION },
      });
      for (const text of ['   ', 'α'.repeat(2001)]) {
        await gw
          .http()
          .post(`/api/conversations/${CONVERSATION}/messages`)
          .set('Authorization', await gw.bearer())
          .send({ messageId: randomUUID(), text })
          .expect(400);
      }
    });

    it('allows 30 messages per user per minute', async () => {
      bookings.on(MessagingRpc.send, echo);
      const userId = randomUUID();
      const send = async () =>
        gw
          .http()
          .post(`/api/conversations/${CONVERSATION}/messages`)
          .set('Authorization', await gw.bearer(userId))
          .send({ messageId: randomUUID(), text: 'hi' });
      for (let i = 0; i < 30; i++) expect((await send()).status).toBe(201);
      expect((await send()).status).toBe(429);
    });

    it('starts a conversation about an item with 200', async () => {
      bookings.on(MessagingRpc.start, echo);
      const res = await gw
        .http()
        .post(`/api/items/${ITEM}/conversations`)
        .set('Authorization', await gw.bearer())
        .expect(200);
      expect(res.body).toEqual({ echoed: { itemId: ITEM } });
    });

    it('maps offer refusals to 409', async () => {
      bookings.fail(MessagingRpc.sendOffer, {
        code: 'PRICE_ABOVE_LIST',
        message: "An offer can't be more than the listed price",
      });
      const res = await gw
        .http()
        .post(`/api/conversations/${CONVERSATION}/offers`)
        .set('Authorization', await gw.bearer())
        .send({ offerId: randomUUID(), start: START, end: END, rentCents: 500 })
        .expect(409);
      expect(res.body.code).toBe('PRICE_ABOVE_LIST');

      bookings.fail(MessagingRpc.bookOffer, {
        code: 'OFFER_UNAVAILABLE',
        message: 'This offer is no longer available',
      });
      await gw
        .http()
        .post(`/api/offers/${randomUUID()}/book`)
        .set('Authorization', await gw.bearer())
        .send({ bookingId: randomUUID() })
        .expect(409);
    });

    it('reports a message with 204', async () => {
      bookings.on(MessagingRpc.report, () => undefined);
      const messageId = randomUUID();
      await gw
        .http()
        .post(`/api/messages/${messageId}/report`)
        .set('Authorization', await gw.bearer())
        .send({ reason: 'SCAM' })
        .expect(204);
      expect(bookings.callsTo(MessagingRpc.report)[0].message.data).toEqual({
        messageId,
        reason: 'SCAM',
      });
    });
  });
});
