import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  BookingAcceptedV1,
  BookingCancelledV1,
  BookingExpiredV1,
  BookingPaidV1,
  createEnvelope,
  PaymentsRpc,
  type BookingSnapshotV1,
  type CheckoutView,
} from '@borrowbox/contracts';
import {
  startPostgres,
  startRabbitMq,
  type TestPostgres,
  type TestRabbitMq,
} from '@borrowbox/testing';
import {
  startPayments,
  type PaymentsHarness,
} from '../../testing/payments-harness';
import { republishAccounts } from '../accounts/republish-accounts';
import { BOOKING_EVENTS_QUEUE } from './booking-events.consumer';

const HOUR = 60 * 60 * 1000;

/**
 * Checkout end to end (ADR-0019, PR B): real Postgres, Stripe replaced by
 * FakeStripe, webhook signatures checked by the real SDK code.
 */
describe('Checkout (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let service: PaymentsHarness;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    [pg, rabbit] = await Promise.all([startPostgres(), startRabbitMq()]);
    service = await startPayments({
      databaseUrl: pg.urlFor('payments'),
      rabbitmqUrl: rabbit.url,
    });
  });

  afterAll(async () => {
    await service?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop()]);
  });

  beforeEach(() => {
    service.stripe.down = false;
    service.stripe.whileCreatingIntent = undefined;
  });

  afterEach(() => jest.restoreAllMocks());

  /** €20 rent + €50 deposit + €2.00 fee (ADR-0020), 24 hours to pay. */
  function snapshot(
    overrides: Partial<BookingSnapshotV1> = {},
  ): BookingSnapshotV1 {
    const start = new Date(Math.ceil(Date.now() / HOUR) * HOUR + 30 * HOUR);
    return {
      bookingId: randomUUID(),
      itemId: randomUUID(),
      itemTitle: 'Cordless drill',
      lenderId: randomUUID(),
      renterId: randomUUID(),
      start: start.toISOString(),
      end: new Date(start.getTime() + 2 * HOUR).toISOString(),
      rentCents: 2000,
      depositCents: 5000,
      feeCents: 200,
      lenderFeeCents: 150,
      payBy: new Date(Date.now() + 24 * HOUR).toISOString(),
      ...overrides,
    };
  }

  async function accepted(overrides: Partial<BookingSnapshotV1> = {}) {
    const booking = snapshot(overrides);
    await service.receive(createEnvelope(BookingAcceptedV1, booking));
    return booking;
  }

  const as = async (userId: string) => ({
    accessToken: await service.tokenFor(userId),
  });

  const start = async (b: BookingSnapshotV1, userId = b.renterId) =>
    service.send(
      PaymentsRpc.startCheckout,
      { bookingId: b.bookingId },
      await as(userId),
    );

  const payment = async (b: BookingSnapshotV1) =>
    service.send(
      PaymentsRpc.getPayment,
      { bookingId: b.bookingId },
      await as(b.renterId),
    );

  /** Stripe tells Payments about the PaymentIntent, and the worker catches up. */
  async function stripeSays(type: string, intentId: string, eventId?: string) {
    await service.webhook('platform', {
      id: eventId ?? `evt_${randomUUID().replace(/-/g, '')}`,
      type,
      data: { object: { id: intentId } },
    });
    await service.runDue();
  }

  async function outbox(bookingId: string) {
    const rows: Array<{ type: string; payload: Record<string, unknown> }> =
      await service.dataSource.query(
        `SELECT envelope->>'type' AS type, envelope->'payload' AS payload
           FROM outbox WHERE envelope->'payload'->>'bookingId' = $1 ORDER BY id`,
        [bookingId],
      );
    return rows;
  }

  const intentOf = (view: CheckoutView) =>
    view.clientSecret.slice(0, view.clientSecret.indexOf('_secret'));

  it('creates one card PaymentIntent for rent + deposit + fee, however often the renter starts', async () => {
    const b = await accepted();
    const first = await start(b);
    const again = await start(b);
    expect(again.clientSecret).toBe(first.clientSecret);
    expect(first).toMatchObject({
      bookingId: b.bookingId,
      status: 'REQUIRES_PAYMENT',
      rentCents: 2000,
      depositCents: 5000,
      feeCents: 200,
      chargeCents: 7200,
      payBy: b.payBy,
      lastAttemptFailed: false,
      paidAt: null,
    });
    expect(service.stripe.intentFor(b.bookingId)?.amountCents).toBe(7200);
    const intents = [...service.stripe.intents.values()].filter(
      (i) => i.bookingId === b.bookingId,
    );
    expect(intents).toHaveLength(1);
    // The client secret is never stored.
    const [row] = await service.dataSource.query(
      `SELECT * FROM payments WHERE booking_id = $1`,
      [b.bookingId],
    );
    expect(JSON.stringify(row)).not.toContain('secret');
  });

  it('lets only the renter pay, only while the booking waits, until 10 minutes before the pay-by time', async () => {
    const b = await accepted();
    await expect(start(b, b.lenderId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      start({ ...b, bookingId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const late = await accepted({
      payBy: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    await expect(start(late)).rejects.toMatchObject({
      code: 'PAYMENT_WINDOW_CLOSED',
    });

    const cancelled = await accepted();
    await service.receive(
      createEnvelope(BookingCancelledV1, { ...cancelled, reason: 'RENTER' }),
    );
    await expect(start(cancelled)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('says PROVIDER_UNAVAILABLE while Stripe is down, then works', async () => {
    const b = await accepted();
    service.stripe.down = true;
    await expect(start(b)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    service.stripe.down = false;
    await expect(start(b)).resolves.toMatchObject({
      status: 'REQUIRES_PAYMENT',
    });
  });

  it('captures the payment once Stripe says it succeeded, and tells Bookings once', async () => {
    const b = await accepted();
    const view = await start(b);
    const intent = intentOf(view);
    service.stripe.setIntent(intent, 'succeeded');
    await stripeSays('payment_intent.succeeded', intent, 'evt_paid_once');
    await stripeSays('payment_intent.succeeded', intent, 'evt_paid_once');
    // A late copy of an earlier failure changes nothing: the current state wins.
    await stripeSays('payment_intent.payment_failed', intent);

    const events = await outbox(b.bookingId);
    expect(events.map((e) => e.type)).toEqual(['payment.captured']);
    expect(events[0].payload).toEqual({
      bookingId: b.bookingId,
      amountCents: 7200,
    });
    expect(await payment(b)).toMatchObject({
      status: 'SUCCEEDED',
      paidAt: expect.any(String),
    });
  });

  it('tells the renter when an attempt fails; they can try again', async () => {
    const b = await accepted();
    const view = await start(b);
    const intent = intentOf(view);
    service.stripe.setIntent(intent, 'requires_payment_method', true);
    await stripeSays('payment_intent.payment_failed', intent);

    const events = await outbox(b.bookingId);
    expect(events.map((e) => e.type)).toEqual(['payment.failed']);
    expect(events[0].payload).toEqual({
      bookingId: b.bookingId,
      renterId: b.renterId,
      lenderId: b.lenderId,
      itemTitle: 'Cordless drill',
      amountCents: 7200,
      payBy: b.payBy,
    });
    expect(await payment(b)).toMatchObject({
      status: 'REQUIRES_PAYMENT',
      lastAttemptFailed: true,
    });
    await expect(start(b)).resolves.toMatchObject({
      clientSecret: view.clientSecret,
    });
  });

  it('cancels the PaymentIntent at Stripe when the booking closes unpaid', async () => {
    const b = await accepted();
    const intent = intentOf(await start(b));
    await service.receive(
      createEnvelope(BookingExpiredV1, { ...b, reason: 'PAYMENT_TIMEOUT' }),
    );
    await service.runDue();
    expect(service.stripe.intentFor(b.bookingId)?.status).toBe('canceled');
    expect(intent).toBeTruthy();
    expect(await payment(b)).toMatchObject({
      status: 'CANCELLED',
      payBy: null,
    });
    await expect(start(b)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('never captures a payment that succeeded after the booking closed: a refund is due', async () => {
    const errors = jest.spyOn(Logger.prototype, 'error');
    const b = await accepted();
    const intent = intentOf(await start(b));
    // The renter finished paying just as the booking expired.
    service.stripe.setIntent(intent, 'succeeded');
    await service.receive(
      createEnvelope(BookingExpiredV1, { ...b, reason: 'PAYMENT_TIMEOUT' }),
    );
    await service.runDue(); // the cancel is refused: Stripe has the money
    await stripeSays('payment_intent.succeeded', intent);

    // Never captured; refunded in full in the same run (ADR-0021).
    expect(await payment(b)).toMatchObject({
      status: 'REFUNDED',
      paidAt: expect.any(String),
      refundedCents: 7200,
    });
    expect((await outbox(b.bookingId)).map((e) => e.type)).toEqual([
      'payment.refunded',
    ]);
    expect(errors.mock.calls.map((c) => String(c[0])).join(' | ')).toContain(
      'refund due',
    );
  });

  it('marks a refund due when a paid booking is cancelled', async () => {
    const b = await accepted();
    const intent = intentOf(await start(b));
    service.stripe.setIntent(intent, 'succeeded');
    await stripeSays('payment_intent.succeeded', intent);
    await service.receive(createEnvelope(BookingPaidV1, b));
    await service.receive(
      createEnvelope(BookingCancelledV1, { ...b, reason: 'ITEM_DELETED' }),
    );
    expect((await payment(b)).status).toBe('NEEDS_REFUND');
  });

  it('keeps a closed booking closed when its events arrive out of order, and handles each once', async () => {
    const b = snapshot();
    const cancelled = createEnvelope(BookingCancelledV1, {
      ...b,
      reason: 'LENDER',
    });
    await service.receive(cancelled);
    await service.receive(cancelled);
    await service.receive(createEnvelope(BookingAcceptedV1, b)); // late
    await expect(start(b)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const rows = await service.dataSource.query(
      `SELECT 1 FROM processed_events WHERE consumer = $1 AND event_id = $2`,
      [BOOKING_EVENTS_QUEUE, cancelled.eventId],
    );
    expect(rows).toHaveLength(1);
  });

  it('works out the fees of a booking accepted before they travelled in events', async () => {
    const b = await accepted({
      feeCents: undefined,
      lenderFeeCents: undefined,
    });
    // bookingFees(2000, 5000): the same €2.00.
    expect(await start(b)).toMatchObject({ feeCents: 200, chargeCents: 7200 });
  });

  it('hands out no client secret when the booking closes while Stripe creates the PaymentIntent', async () => {
    const b = await accepted();
    service.stripe.whileCreatingIntent = () =>
      service.receive(
        createEnvelope(BookingCancelledV1, { ...b, reason: 'RENTER' }),
      );
    await expect(start(b)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await service.runDue();
    expect(service.stripe.intentFor(b.bookingId)?.status).toBe('canceled');
  });

  it("exports the renter's payments", async () => {
    const b = await accepted();
    await start(b);
    const exported = await service.send(
      PaymentsRpc.exportMe,
      {},
      await as(b.renterId),
    );
    expect(exported.payments).toEqual([
      expect.objectContaining({
        bookingId: b.bookingId,
        status: 'REQUIRES_PAYMENT',
        chargeCents: 7200,
        paidAt: null,
      }),
    ]);
  });

  it('republishes every payable lender for services that started later', async () => {
    const ready = randomUUID();
    const notReady = randomUUID();
    await service.dataSource.query(
      `INSERT INTO connected_accounts (id, user_id, ready) VALUES ($1, $2, true), ($3, $4, false)`,
      [randomUUID(), ready, randomUUID(), notReady],
    );
    await republishAccounts(service.dataSource);
    const rows: Array<{ user_id: string }> = await service.dataSource.query(
      `SELECT envelope->'payload'->>'userId' AS user_id FROM outbox
        WHERE routing_key = 'payment.account_ready.v1'`,
    );
    const ids = rows.map((r) => r.user_id);
    expect(ids).toContain(ready);
    expect(ids).not.toContain(notReady);
  });
});
