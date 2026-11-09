import Redis from 'ioredis';
import { PaymentsRpc } from '@borrowbox/contracts';
import { startRedis, type TestRedis } from '@borrowbox/testing';
import {
  FakeCatalog,
  FakeIdentity,
  FakePayments,
} from '../../testing/fake-service';
import {
  startGateway,
  type GatewayHarness,
} from '../../testing/gateway-harness';

/**
 * Payments' HTTP API on the real gateway (guards, rate limits, raw webhook
 * bodies, error mapping) against a scripted Payments over real TCP.
 */
describe('Payout and webhook routes (integration)', () => {
  let redis: TestRedis;
  let identity: FakeIdentity;
  let catalog: FakeCatalog;
  let payments: FakePayments;
  let gw: GatewayHarness;
  let redisClient: Redis;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    redis = await startRedis();
    identity = new FakeIdentity();
    catalog = new FakeCatalog();
    payments = new FakePayments();
    await Promise.all([identity.start(), catalog.start(), payments.start()]);
    gw = await startGateway({
      redisUrl: redis.url,
      identityPort: identity.port,
      catalogPort: catalog.port,
      paymentsPort: payments.port,
    });
    redisClient = new Redis(redis.url);
  });

  afterAll(async () => {
    await gw?.close();
    await Promise.all([identity?.stop(), catalog?.stop(), payments?.stop()]);
    await redisClient?.quit();
    process.env = savedEnv;
    await redis?.stop();
  });

  beforeEach(async () => {
    payments.reset();
    await redisClient.flushall(); // rate-limit counters
  });

  const link = { url: 'https://connect.stripe.test/x', expiresAt: null };

  describe('payouts', () => {
    it('needs a signed-in user', async () => {
      await gw.http().get('/api/me/payouts').expect(401);
      await gw.http().post('/api/me/payouts/onboarding').expect(401);
      expect(payments.calls).toHaveLength(0);
    });

    it('forwards the token and returns the status', async () => {
      const status = {
        status: 'READY',
        payoutsEnabled: true,
        updatedAt: '2026-11-07T10:00:00.000Z',
      };
      payments.on(PaymentsRpc.getPayouts, () => status);
      const auth = await gw.bearer();
      const res = await gw
        .http()
        .get('/api/me/payouts')
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toEqual(status);
      expect(
        payments.callsTo(PaymentsRpc.getPayouts)[0].message.accessToken,
      ).toBe(auth.slice('Bearer '.length));
    });

    it('answers onboarding and dashboard with a Stripe link', async () => {
      payments.on(PaymentsRpc.startOnboarding, () => link);
      payments.on(PaymentsRpc.dashboardLink, () => link);
      const auth = await gw.bearer();
      for (const path of ['onboarding', 'dashboard']) {
        const res = await gw
          .http()
          .post(`/api/me/payouts/${path}`)
          .set('Authorization', auth)
          .expect(200);
        expect(res.body).toEqual(link);
      }
    });

    it.each([
      ['EMAIL_NOT_VERIFIED', 403],
      ['PAYOUTS_NOT_SET_UP', 409],
      ['PROVIDER_UNAVAILABLE', 503],
    ])('maps %s to %i', async (code, status) => {
      payments.fail(PaymentsRpc.startOnboarding, { code, message: 'm' });
      const res = await gw
        .http()
        .post('/api/me/payouts/onboarding')
        .set('Authorization', await gw.bearer())
        .expect(status);
      expect(res.body.code).toBe(code);
    });

    it('limits Stripe links to 10 per minute', async () => {
      payments.on(PaymentsRpc.startOnboarding, () => link);
      const auth = await gw.bearer();
      for (let i = 0; i < 10; i++) {
        await gw
          .http()
          .post('/api/me/payouts/onboarding')
          .set('Authorization', auth)
          .expect(200);
      }
      await gw
        .http()
        .post('/api/me/payouts/onboarding')
        .set('Authorization', auth)
        .expect(429);
    });
  });

  describe('Stripe webhooks', () => {
    // Spacing JSON.stringify would not reproduce: the bytes must arrive as sent.
    const body = '{"id": "evt_1",\n  "type":"account.updated"}';

    it.each([
      ['/api/webhooks/stripe', 'platform'],
      ['/api/webhooks/stripe-connect', 'connect'],
    ])('%s forwards the raw body and signature', async (path, source) => {
      payments.on(PaymentsRpc.receiveWebhook, () => undefined);
      const res = await gw
        .http()
        .post(path)
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 't=1,v1=abc')
        .send(body)
        .expect(200);
      expect(res.body).toEqual({ received: true });
      const [call] = payments.callsTo(PaymentsRpc.receiveWebhook);
      expect(call.message.data).toEqual({
        source,
        payload: body,
        signature: 't=1,v1=abc',
      });
      expect(call.message.accessToken).toBeUndefined();
    });

    it('refuses a body without a signature before calling Payments', async () => {
      await gw
        .http()
        .post('/api/webhooks/stripe-connect')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(400);
      expect(payments.calls).toHaveLength(0);
    });

    it('answers 400 when Payments rejects the signature', async () => {
      payments.fail(PaymentsRpc.receiveWebhook, {
        code: 'INVALID_SIGNATURE',
        message: 'Invalid signature',
      });
      const res = await gw
        .http()
        .post('/api/webhooks/stripe-connect')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 't=1,v1=bad')
        .send(body)
        .expect(400);
      expect(res.body.code).toBe('INVALID_SIGNATURE');
    });

    it('is not rate limited (Stripe sends bursts)', async () => {
      payments.on(PaymentsRpc.receiveWebhook, () => undefined);
      for (let i = 0; i < 130; i++) {
        await gw
          .http()
          .post('/api/webhooks/stripe-connect')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', 't=1,v1=abc')
          .send(body)
          .expect(200);
      }
    });
  });

  describe('booking payment', () => {
    const BOOKING = '7b0e4a6c-2f1d-4f6b-9a8e-3c5d2e1f0a9b';
    const view = {
      bookingId: BOOKING,
      status: 'REQUIRES_PAYMENT',
      rentCents: 2000,
      depositCents: 5000,
      feeCents: 200,
      chargeCents: 7200,
      payBy: '2026-11-09T10:00:00.000Z',
      lastAttemptFailed: false,
      paidAt: null,
    };

    it('needs a signed-in user and a well-formed booking id', async () => {
      await gw.http().post(`/api/bookings/${BOOKING}/payment`).expect(401);
      await gw
        .http()
        .post('/api/bookings/not-a-uuid/payment')
        .set('Authorization', await gw.bearer())
        .expect(400);
      expect(payments.calls).toHaveLength(0);
    });

    it('starts paying with the renter’s token and returns the client secret', async () => {
      payments.on(PaymentsRpc.startCheckout, () => ({
        ...view,
        clientSecret: 'pi_1_secret_x',
      }));
      const auth = await gw.bearer();
      const res = await gw
        .http()
        .post(`/api/bookings/${BOOKING}/payment`)
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toEqual({ ...view, clientSecret: 'pi_1_secret_x' });
      const call = payments.callsTo(PaymentsRpc.startCheckout)[0].message;
      expect(call.data).toEqual({ bookingId: BOOKING });
      expect(call.accessToken).toBe(auth.slice('Bearer '.length));
    });

    it('reads the payment', async () => {
      payments.on(PaymentsRpc.getPayment, () => view);
      const res = await gw
        .http()
        .get(`/api/bookings/${BOOKING}/payment`)
        .set('Authorization', await gw.bearer())
        .expect(200);
      expect(res.body).toEqual(view);
    });

    it.each([
      ['NOT_FOUND', 404],
      ['INVALID_STATE', 409],
      ['PAYMENT_WINDOW_CLOSED', 409],
      ['PROVIDER_UNAVAILABLE', 503],
    ])('maps %s to %i', async (code, status) => {
      payments.fail(PaymentsRpc.startCheckout, { code, message: 'm' });
      const res = await gw
        .http()
        .post(`/api/bookings/${BOOKING}/payment`)
        .set('Authorization', await gw.bearer())
        .expect(status);
      expect(res.body.code).toBe(code);
    });
  });
});
