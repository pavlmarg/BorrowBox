import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  BookingAcceptedV1,
  BookingCancelledV1,
  BookingCompletedV1,
  BookingDisputedV1,
  BookingPaidV1,
  createEnvelope,
  PaymentsRpc,
  type BookingSnapshotV1,
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
import { PaymentsWorker } from '../payments.worker';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Refunds and settlement end to end (ADR-0021, PR C): real Postgres, Stripe
 * replaced by FakeStripe. Every case is the €20 rent + €50 deposit booking
 * (€2.00 fee, €1.50 lender fee: the renter paid €72.00).
 */
describe('Refunds and settlement (integration)', () => {
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
    service.stripe.refundStatus = 'SUCCEEDED';
  });

  afterEach(() => jest.restoreAllMocks());

  /** A lender who can be paid (their Stripe account is ready). */
  async function payableLender(): Promise<{
    userId: string;
    accountId: string;
  }> {
    const userId = randomUUID();
    const accountId = `acct_lender_${userId.slice(0, 8)}`;
    await service.dataSource.query(
      `INSERT INTO connected_accounts (id, user_id, stripe_account_id, ready)
       VALUES ($1, $2, $3, true)`,
      [randomUUID(), userId, accountId],
    );
    return { userId, accountId };
  }

  /** An accepted, paid booking (booking.paid seen), starting in `startInHours`. */
  async function paidBooking(startInHours = 30, lenderId?: string) {
    const startAt = new Date(
      Math.ceil(Date.now() / HOUR) * HOUR + startInHours * HOUR,
    );
    const b: BookingSnapshotV1 = {
      bookingId: randomUUID(),
      itemId: randomUUID(),
      itemTitle: 'Cordless drill',
      lenderId: lenderId ?? (await payableLender()).userId,
      renterId: randomUUID(),
      start: startAt.toISOString(),
      end: new Date(startAt.getTime() + 2 * HOUR).toISOString(),
      rentCents: 2000,
      depositCents: 5000,
      feeCents: 200,
      lenderFeeCents: 150,
      payBy: new Date(
        Math.min(Date.now() + 24 * HOUR, startAt.getTime()),
      ).toISOString(),
    };
    await service.receive(createEnvelope(BookingAcceptedV1, b));
    const view = await service.send(
      PaymentsRpc.startCheckout,
      { bookingId: b.bookingId },
      { accessToken: await service.tokenFor(b.renterId) },
    );
    const intent = view.clientSecret.slice(
      0,
      view.clientSecret.indexOf('_secret'),
    );
    service.stripe.setIntent(intent, 'succeeded');
    await stripeSays('payment_intent.succeeded', intent);
    await service.receive(createEnvelope(BookingPaidV1, b));
    return { b, intent };
  }

  async function stripeSays(type: string, objectId: string) {
    await service.webhook('platform', {
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type,
      data: { object: { id: objectId } },
    });
    await service.runDue();
  }

  const cancel = (
    b: BookingSnapshotV1,
    reason: 'RENTER' | 'LENDER' | 'ITEM_DELETED' | 'ACCOUNT_DELETED',
    erasedUserId?: string,
  ) =>
    service.receive(
      createEnvelope(BookingCancelledV1, {
        ...b,
        reason,
        ...(erasedUserId ? { erasedUserId } : {}),
      }),
    );

  async function payment(b: BookingSnapshotV1) {
    return service.send(
      PaymentsRpc.getPayment,
      { bookingId: b.bookingId },
      { accessToken: await service.tokenFor(b.renterId) },
    );
  }

  const refundsOf = (intent: string) =>
    [...service.stripe.refunds.values()]
      .filter((r) => r.paymentIntentId === intent)
      .map((r) => r.amountCents);

  const transfersOf = (b: BookingSnapshotV1) =>
    service.stripe.transfers.filter((t) => t.bookingId === b.bookingId);

  async function events(bookingId: string) {
    const rows: Array<{ type: string; payload: Record<string, unknown> }> =
      await service.dataSource.query(
        `SELECT envelope->>'type' AS type, envelope->'payload' AS payload
           FROM outbox WHERE envelope->'payload'->>'bookingId' = $1
            AND envelope->>'type' IN ('payment.refunded', 'payment.settled')
          ORDER BY id`,
        [bookingId],
      );
    return rows;
  }

  describe('cancellations', () => {
    it('keeps the €2.00 fee when the renter cancels more than 24 hours ahead', async () => {
      const { b, intent } = await paidBooking(30);
      await cancel(b, 'RENTER');
      await service.runDue();
      expect(refundsOf(intent)).toEqual([7000]);
      expect(transfersOf(b)).toEqual([]);
      expect(await payment(b)).toMatchObject({
        status: 'REFUNDED',
        refundedCents: 7000,
      });
      expect(await events(b.bookingId)).toEqual([
        {
          type: 'payment.refunded',
          payload: {
            bookingId: b.bookingId,
            renterId: b.renterId,
            lenderId: b.lenderId,
            itemTitle: 'Cordless drill',
            amountCents: 7000,
          },
        },
      ]);
    });

    it('splits the rent when the renter cancels within 24 hours', async () => {
      const lender = await payableLender();
      const { b, intent } = await paidBooking(5, lender.userId);
      await cancel(b, 'RENTER');
      await service.runDue();
      expect(refundsOf(intent)).toEqual([6000]);
      expect(transfersOf(b)).toEqual([
        expect.objectContaining({
          amountCents: 850,
          destinationAccountId: lender.accountId,
          sourceChargeId: `ch_for_${intent}`,
        }),
      ]);
      expect((await payment(b)).status).toBe('REFUNDED');
    });

    it.each(['LENDER', 'ITEM_DELETED'] as const)(
      'refunds everything when cancelled by %s',
      async (reason) => {
        const { b, intent } = await paidBooking(30);
        await cancel(b, reason);
        await service.runDue();
        expect(refundsOf(intent)).toEqual([7200]);
      },
    );

    it("treats a renter's erasure as the renter cancelling, a lender's as not", async () => {
      const byRenter = await paidBooking(30);
      await cancel(byRenter.b, 'ACCOUNT_DELETED', byRenter.b.renterId);
      const byLender = await paidBooking(30);
      await cancel(byLender.b, 'ACCOUNT_DELETED', byLender.b.lenderId);
      await service.runDue();
      expect(refundsOf(byRenter.intent)).toEqual([7000]);
      expect(refundsOf(byLender.intent)).toEqual([7200]);
    });

    it('refunds everything when the booking never went ahead (no booking.paid seen)', async () => {
      const { b, intent } = await paidBooking(30);
      // A second booking whose payment came through but booking.paid never arrived:
      const other = { ...b, bookingId: randomUUID() };
      await service.receive(createEnvelope(BookingAcceptedV1, other));
      const view = await service.send(
        PaymentsRpc.startCheckout,
        { bookingId: other.bookingId },
        { accessToken: await service.tokenFor(other.renterId) },
      );
      const otherIntent = view.clientSecret.slice(
        0,
        view.clientSecret.indexOf('_secret'),
      );
      service.stripe.setIntent(otherIntent, 'succeeded');
      await stripeSays('payment_intent.succeeded', otherIntent);
      await cancel(other, 'RENTER');
      await service.runDue();
      expect(refundsOf(otherIntent)).toEqual([7200]);
      expect(refundsOf(intent)).toEqual([]);
    });

    it('plans once, however often the event arrives', async () => {
      const { b, intent } = await paidBooking(30);
      const cancelled = createEnvelope(BookingCancelledV1, {
        ...b,
        reason: 'LENDER',
      });
      await service.receive(cancelled);
      await service.receive(cancelled);
      await cancel(b, 'LENDER'); // a different event, same close: no second plan
      await service.runDue();
      await service.runDue();
      expect(refundsOf(intent)).toEqual([7200]);
      expect(await events(b.bookingId)).toHaveLength(1);
    });
  });

  describe('settlement', () => {
    it('pays the lender €18.50 and returns the €50 deposit when the booking completes', async () => {
      const lender = await payableLender();
      const { b, intent } = await paidBooking(30, lender.userId);
      await service.receive(createEnvelope(BookingCompletedV1, b));
      await service.runDue();
      expect(transfersOf(b)).toEqual([
        expect.objectContaining({
          amountCents: 1850,
          destinationAccountId: lender.accountId,
          sourceChargeId: `ch_for_${intent}`,
        }),
      ]);
      expect(refundsOf(intent)).toEqual([5000]);
      expect(await payment(b)).toMatchObject({
        status: 'SETTLED',
        refundedCents: 5000,
      });
      expect((await events(b.bookingId)).map((e) => e.payload)).toEqual([
        expect.objectContaining({
          payoutCents: 1850,
          depositRefundCents: 5000,
        }),
      ]);
    });

    it('holds the transfer while the lender can’t be paid, and says so after a week', async () => {
      const lenderId = randomUUID(); // no Stripe account yet
      const { b, intent } = await paidBooking(30, lenderId);
      await service.receive(createEnvelope(BookingCompletedV1, b));
      await service.runDue();
      expect(refundsOf(intent)).toEqual([5000]); // the deposit doesn't wait
      expect(transfersOf(b)).toEqual([]);
      expect((await payment(b)).status).toBe('SUCCEEDED');

      const errors = jest.spyOn(Logger.prototype, 'error');
      const due = () =>
        service.dataSource.query(
          `UPDATE money_movements SET next_attempt_at = now() WHERE booking_id = $1`,
          [b.bookingId],
        );
      await due();
      await service.app
        .get(PaymentsWorker)
        .runDue(new Date(Date.now() + 8 * DAY));
      expect(errors.mock.calls.map((c) => String(c[0])).join(' | ')).toContain(
        "waits for the lender's payouts",
      );

      await service.dataSource.query(
        `INSERT INTO connected_accounts (id, user_id, stripe_account_id, ready)
         VALUES ($1, $2, 'acct_late', true)`,
        [randomUUID(), lenderId],
      );
      await due();
      await service.runDue();
      expect(transfersOf(b)).toEqual([
        expect.objectContaining({
          amountCents: 1850,
          destinationAccountId: 'acct_late',
        }),
      ]);
      expect((await payment(b)).status).toBe('SETTLED');
    });

    it('holds everything while a booking is disputed', async () => {
      const { b, intent } = await paidBooking(30);
      await service.receive(createEnvelope(BookingDisputedV1, b));
      await service.runDue();
      expect(refundsOf(intent)).toEqual([]);
      expect(transfersOf(b)).toEqual([]);
      // Resolved (dispute.resolved → COMPLETED, Phase 5 and the admin area):
      await service.receive(createEnvelope(BookingCompletedV1, b));
      await service.runDue();
      expect(transfersOf(b)).toHaveLength(1);
      expect((await payment(b)).status).toBe('SETTLED');
    });
  });

  describe('carrying it out', () => {
    it('follows a refund that is pending at first, and logs one that fails', async () => {
      service.stripe.refundStatus = 'PENDING';
      const { b, intent } = await paidBooking(30);
      await cancel(b, 'LENDER');
      await service.runDue();
      // Accepted by Stripe: the renter is told it's on its way.
      expect((await payment(b)).status).toBe('REFUNDED');
      const [refundId] = [...service.stripe.refunds.entries()]
        .filter(([, r]) => r.paymentIntentId === intent)
        .map(([id]) => id);
      service.stripe.setRefund(refundId, 'SUCCEEDED');
      await stripeSays('refund.updated', refundId);
      const [row] = await service.dataSource.query(
        `SELECT status FROM money_movements WHERE stripe_object_id = $1`,
        [refundId],
      );
      expect(row.status).toBe('SUCCEEDED');

      const failing = await paidBooking(30);
      await cancel(failing.b, 'LENDER');
      await service.runDue();
      const [failingId] = [...service.stripe.refunds.entries()]
        .filter(([, r]) => r.paymentIntentId === failing.intent)
        .map(([id]) => id);
      const errors = jest.spyOn(Logger.prototype, 'error');
      service.stripe.setRefund(failingId, 'FAILED');
      await stripeSays('refund.failed', failingId);
      expect(errors.mock.calls.map((c) => String(c[0])).join(' | ')).toContain(
        'check it by hand',
      );
    });

    it('retries while Stripe is down, and never refunds twice', async () => {
      const { b, intent } = await paidBooking(30);
      await cancel(b, 'LENDER');
      service.stripe.down = true;
      await service.runDue();
      expect(refundsOf(intent)).toEqual([]);
      service.stripe.down = false;
      await service.dataSource.query(
        `UPDATE money_movements SET next_attempt_at = now() WHERE booking_id = $1`,
        [b.bookingId],
      );
      await service.runDue();
      await service.runDue();
      expect(refundsOf(intent)).toEqual([7200]);
    });

    it('refuses, in the database, to plan more than was charged', async () => {
      const { b } = await paidBooking(30);
      await expect(
        service.dataSource.query(
          `UPDATE payments SET refunded_cents = amount_cents + 1 WHERE booking_id = $1`,
          [b.bookingId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('orphaned Stripe accounts (daily)', () => {
    it('saves a lost id, deletes accounts nobody owns, and leaves others alone', async () => {
      const lost = randomUUID();
      await service.dataSource.query(
        `INSERT INTO connected_accounts (id, user_id) VALUES ($1, $2)`,
        [randomUUID(), lost],
      );
      service.stripe.extraAccounts.push(
        { id: 'acct_lost_id', userId: lost },
        { id: 'acct_nobody', userId: randomUUID() },
        { id: 'acct_made_by_hand', userId: null },
      );
      await service.app.get(PaymentsWorker).reconcileAccounts();

      const [row] = await service.dataSource.query(
        `SELECT stripe_account_id FROM connected_accounts WHERE user_id = $1`,
        [lost],
      );
      expect(row.stripe_account_id).toBe('acct_lost_id');
      expect(service.stripe.deleted).toContain('acct_nobody');
      expect(service.stripe.deleted).not.toContain('acct_lost_id');
      expect(service.stripe.deleted).not.toContain('acct_made_by_hand');
    });
  });

  it("exports the renter's refunds and the lender's payouts", async () => {
    const lender = await payableLender();
    const { b } = await paidBooking(30, lender.userId);
    await service.receive(createEnvelope(BookingCompletedV1, b));
    await service.runDue();
    const asRenter = await service.send(
      PaymentsRpc.exportMe,
      {},
      { accessToken: await service.tokenFor(b.renterId) },
    );
    expect(asRenter.payments).toEqual([
      expect.objectContaining({ refundedCents: 5000, status: 'SETTLED' }),
    ]);
    const asLender = await service.send(
      PaymentsRpc.exportMe,
      {},
      { accessToken: await service.tokenFor(lender.userId) },
    );
    expect(asLender.payouts).toEqual([
      expect.objectContaining({
        bookingId: b.bookingId,
        amountCents: 1850,
        status: 'SUCCEEDED',
      }),
    ]);
  });
});
