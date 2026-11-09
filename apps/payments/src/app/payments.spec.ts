import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  createEnvelope,
  PaymentsRpc,
  UserDeletionRequestedV1,
  UserEmailVerifiedV1,
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
} from '../testing/payments-harness';
import { MIGRATIONS } from './database/database.module';
import { USER_EVENTS_QUEUE } from './users/user-events.consumer';

/**
 * Payments end to end (PR A): real Postgres and RabbitMQ, Stripe replaced
 * by FakeStripe (P11), webhook signatures checked by the real SDK code.
 */
describe('Payments (integration)', () => {
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
    service.stripe.refusing = false;
    service.stripe.whileCreating = undefined;
  });

  afterEach(() => jest.restoreAllMocks());

  /** A user Payments knows as verified, and their access token. */
  async function lender(verified = true) {
    const userId = randomUUID();
    if (verified) {
      await service.receive(createEnvelope(UserEmailVerifiedV1, { userId }));
    }
    return { userId, accessToken: await service.tokenFor(userId) };
  }

  async function onboard(accessToken: string) {
    return service.send(PaymentsRpc.startOnboarding, {}, { accessToken });
  }

  async function accountIdOf(userId: string): Promise<string> {
    const [row] = await service.dataSource.query(
      `SELECT stripe_account_id FROM connected_accounts WHERE user_id = $1`,
      [userId],
    );
    return row.stripe_account_id;
  }

  async function outboxFor(userId: string): Promise<string[]> {
    const rows: Array<{ type: string }> = await service.dataSource.query(
      `SELECT envelope->>'type' AS type FROM outbox
        WHERE envelope->'payload'->>'userId' = $1 ORDER BY id`,
      [userId],
    );
    return rows.map((r) => r.type);
  }

  /** Stripe tells Payments the account changed, and the worker catches up. */
  async function accountUpdated(accountId: string) {
    await service.webhook('connect', {
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: 'account.updated',
      account: accountId,
    });
    await service.runDue();
  }

  it('migrates into the payments schema', async () => {
    expect(await service.dataSource.showMigrations()).toBe(false);
    expect(MIGRATIONS).toHaveLength(2);
    const [{ schema }] = await service.dataSource.query(
      `SELECT current_schema() AS schema`,
    );
    expect(schema).toBe('payments');
  });

  describe('onboarding', () => {
    it('needs a verified email', async () => {
      const { accessToken } = await lender(false);
      await expect(onboard(accessToken)).rejects.toMatchObject({
        code: 'EMAIL_NOT_VERIFIED',
      });
    });

    it('creates one Stripe account, however often it is asked', async () => {
      const { userId, accessToken } = await lender();
      const first = await onboard(accessToken);
      const second = await onboard(accessToken);

      const accountId = await accountIdOf(userId);
      expect(service.stripe.created.filter((a) => a.userId === userId)).toEqual(
        [{ id: accountId, userId, country: 'GR' }],
      );
      for (const link of [first, second]) {
        expect(link.url).toContain(accountId);
        const url = new URL(link.url);
        expect(url.searchParams.get('return')).toBe(
          'https://borrowbox.test/settings/payouts?stripe=return',
        );
        expect(url.searchParams.get('refresh')).toBe(
          'https://borrowbox.test/settings/payouts?stripe=refresh',
        );
        expect(link.expiresAt).not.toBeNull();
      }
    });

    it('reuses the same Stripe account after Stripe was unreachable', async () => {
      const { userId, accessToken } = await lender();
      service.stripe.down = true;
      await expect(onboard(accessToken)).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
      });
      service.stripe.down = false;
      await onboard(accessToken);
      await onboard(accessToken);
      expect(
        service.stripe.created.filter((a) => a.userId === userId),
      ).toHaveLength(1);
    });

    it('answers INTERNAL when Stripe refuses the call, logging what identifies it', async () => {
      const { accessToken } = await lender();
      const errors = jest.spyOn(Logger.prototype, 'error');
      service.stripe.refusing = true;
      await expect(onboard(accessToken)).rejects.toMatchObject({
        code: 'INTERNAL',
      });
      const logged = errors.mock.calls.map((c) => String(c[0])).join(' | ');
      expect(logged).toContain('StripeRequestError');
      expect(logged).toContain('StripePermissionError');
      expect(logged).toContain('status=403');
      expect(logged).toContain('request=req_test_refused');
    });

    it('hands out no link when the account is erased while Stripe creates it', async () => {
      const { userId, accessToken } = await lender();
      service.stripe.whileCreating = () =>
        service.receive(createEnvelope(UserDeletionRequestedV1, { userId }));
      await expect(onboard(accessToken)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      // The id was saved, so the worker deletes the new Stripe account.
      const accountId = await accountIdOf(userId);
      expect(accountId).toMatch(/^acct_test/);
      await service.runDue();
      expect(service.stripe.deleted).toContain(accountId);
    });

    it('shows INCOMPLETE once started, NOT_STARTED before', async () => {
      const { accessToken } = await lender();
      const status = () =>
        service.send(PaymentsRpc.getPayouts, {}, { accessToken });
      expect(await status()).toEqual({
        status: 'NOT_STARTED',
        payoutsEnabled: false,
        updatedAt: null,
      });
      await onboard(accessToken);
      expect((await status()).status).toBe('INCOMPLETE');
    });

    it('gives the dashboard only once the details are sent', async () => {
      const { userId, accessToken } = await lender();
      const dashboard = () =>
        service.send(PaymentsRpc.dashboardLink, {}, { accessToken });
      await expect(dashboard()).rejects.toMatchObject({
        code: 'PAYOUTS_NOT_SET_UP',
      });
      await onboard(accessToken);
      const accountId = await accountIdOf(userId);
      service.stripe.setFlags(accountId, { detailsSubmitted: true });
      await accountUpdated(accountId);
      expect((await dashboard()).url).toContain(accountId);
    });
  });

  describe('webhooks', () => {
    it('refuses a body Stripe did not sign', async () => {
      await expect(
        service.webhook(
          'connect',
          { id: 'evt_forged', type: 'account.updated', account: 'acct_x' },
          't=1,v1=deadbeef',
        ),
      ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    });

    it("refuses an event signed with the other endpoint's secret", async () => {
      const payload = JSON.stringify({
        id: 'evt_swap',
        type: 'account.updated',
      });
      await expect(
        service.send(PaymentsRpc.receiveWebhook, {
          source: 'platform',
          payload,
          signature: service.stripe.sign(payload, 'whsec_testconnect'),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    });

    it('stores an event once, without its payload', async () => {
      const event = {
        id: 'evt_twice',
        type: 'account.updated',
        account: 'acct_unknown',
      };
      await service.webhook('connect', event);
      await service.webhook('connect', event);
      const rows = await service.dataSource.query(
        `SELECT * FROM stripe_events WHERE event_id = 'evt_twice'`,
      );
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]).sort()).toEqual([
        'account_id',
        'attempts',
        'event_id',
        'next_attempt_at',
        'processed_at',
        'received_at',
        'source',
        'type',
      ]);
    });

    it('acknowledges event types it does not handle without storing them', async () => {
      await service.webhook('connect', {
        id: 'evt_other',
        type: 'payout.paid',
      });
      const rows = await service.dataSource.query(
        `SELECT 1 FROM stripe_events WHERE event_id = 'evt_other'`,
      );
      expect(rows).toHaveLength(0);
    });

    it('announces when a lender becomes payable, and when that stops', async () => {
      const { userId, accessToken } = await lender();
      await onboard(accessToken);
      const accountId = await accountIdOf(userId);

      service.stripe.setFlags(accountId, {
        detailsSubmitted: true,
        transfersActive: true,
        payoutsEnabled: true,
      });
      await accountUpdated(accountId);
      await accountUpdated(accountId); // nothing new: no second event
      expect(
        await service.send(PaymentsRpc.getPayouts, {}, { accessToken }),
      ).toMatchObject({ status: 'READY', payoutsEnabled: true });
      expect(await outboxFor(userId)).toEqual(['payment.account_ready']);

      service.stripe.setFlags(accountId, {
        transfersActive: false,
        disabled: true,
      });
      await accountUpdated(accountId);
      expect(
        (await service.send(PaymentsRpc.getPayouts, {}, { accessToken }))
          .status,
      ).toBe('RESTRICTED');
      expect(await outboxFor(userId)).toEqual([
        'payment.account_ready',
        'payment.account_restricted',
      ]);
    });

    it('skips events about unknown or erased accounts without asking Stripe', async () => {
      const { userId, accessToken } = await lender();
      await onboard(accessToken);
      const erased = await accountIdOf(userId);
      await service.receive(
        createEnvelope(UserDeletionRequestedV1, { userId }),
      );
      await service.runDue(); // deletes it at Stripe

      for (const accountId of ['acct_made_elsewhere', erased]) {
        await accountUpdated(accountId);
        const [event] = await service.dataSource.query(
          `SELECT processed_at, attempts FROM stripe_events
            WHERE account_id = $1`,
          [accountId],
        );
        expect(event.processed_at).not.toBeNull();
        expect(event.attempts).toBe(0);
        expect(service.stripe.retrieved).not.toContain(accountId);
      }
    });

    it('retries an event while Stripe is unreachable', async () => {
      const { userId, accessToken } = await lender();
      await onboard(accessToken);
      const accountId = await accountIdOf(userId);
      service.stripe.setFlags(accountId, { transfersActive: true });

      service.stripe.down = true;
      await accountUpdated(accountId);
      const [pending] = await service.dataSource.query(
        `SELECT attempts, processed_at FROM stripe_events
          WHERE account_id = $1`,
        [accountId],
      );
      expect(pending).toMatchObject({ attempts: 1, processed_at: null });

      service.stripe.down = false;
      await service.dataSource.query(
        `UPDATE stripe_events SET next_attempt_at = now() WHERE account_id = $1`,
        [accountId],
      );
      await service.runDue();
      expect(await outboxFor(userId)).toEqual(['payment.account_ready']);
    });
  });

  describe("Identity's events", () => {
    it('handles the same event once', async () => {
      const userId = randomUUID();
      const event = createEnvelope(UserEmailVerifiedV1, { userId });
      await service.receive(event);
      await service.receive(event);
      const rows = await service.dataSource.query(
        `SELECT 1 FROM processed_events WHERE consumer = $1 AND event_id = $2`,
        [USER_EVENTS_QUEUE, event.eventId],
      );
      expect(rows).toHaveLength(1);
    });

    it('closes an erased account and deletes it at Stripe, retrying', async () => {
      const { userId, accessToken } = await lender();
      await onboard(accessToken);
      const accountId = await accountIdOf(userId);

      await service.receive(
        createEnvelope(UserDeletionRequestedV1, { userId }),
      );
      // The token is still valid for a while, but Payments refuses it.
      await expect(onboard(accessToken)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      await expect(
        service.send(PaymentsRpc.getPayouts, {}, { accessToken }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

      service.stripe.down = true;
      await service.runDue();
      expect(service.stripe.deleted).not.toContain(accountId);

      service.stripe.down = false;
      await service.dataSource.query(
        `UPDATE connected_accounts SET next_deletion_at = now() WHERE user_id = $1`,
        [userId],
      );
      await service.runDue();
      expect(service.stripe.deleted).toContain(accountId);
      const [row] = await service.dataSource.query(
        `SELECT deleted_at, stripe_deleted_at, deletion_attempts
           FROM connected_accounts WHERE user_id = $1`,
        [userId],
      );
      expect(row.deleted_at).not.toBeNull();
      expect(row.stripe_deleted_at).not.toBeNull();
      expect(row.deletion_attempts).toBe(1);
    });

    it('logs a deletion as an error once it has failed 10 times', async () => {
      const { userId, accessToken } = await lender();
      await onboard(accessToken);
      await service.receive(
        createEnvelope(UserDeletionRequestedV1, { userId }),
      );
      await service.dataSource.query(
        `UPDATE connected_accounts SET deletion_attempts = 9 WHERE user_id = $1`,
        [userId],
      );
      const errors = jest.spyOn(Logger.prototype, 'error');
      service.stripe.refusing = true;
      await service.runDue();

      const logged = errors.mock.calls.map((c) => String(c[0])).join(' | ');
      expect(logged).toContain('(attempt 10)');
      expect(logged).toContain('StripeRequestError');
      expect(logged).toContain('request=req_test_refused');
      const [row] = await service.dataSource.query(
        `SELECT stripe_deleted_at, deletion_attempts FROM connected_accounts
          WHERE user_id = $1`,
        [userId],
      );
      // Still kept trying: the account must go.
      expect(row).toEqual({ stripe_deleted_at: null, deletion_attempts: 10 });
    });

    it('waits for a Stripe id that may still be saved, then gives up', async () => {
      const userId = randomUUID();
      await service.dataSource.query(
        `INSERT INTO connected_accounts (id, user_id) VALUES ($1, $2)`,
        [randomUUID(), userId],
      );
      await service.receive(
        createEnvelope(UserDeletionRequestedV1, { userId }),
      );

      await service.runDue();
      const stillWaiting = await service.dataSource.query(
        `SELECT stripe_deleted_at, deletion_attempts FROM connected_accounts
          WHERE user_id = $1`,
        [userId],
      );
      // Waiting isn't failing: no attempt counted.
      expect(stillWaiting[0]).toEqual({
        stripe_deleted_at: null,
        deletion_attempts: 0,
      });

      await service.dataSource.query(
        `UPDATE connected_accounts SET next_deletion_at = now() WHERE user_id = $1`,
        [userId],
      );
      await service.runDue(new Date(Date.now() + 11 * 60_000));
      const done = await service.dataSource.query(
        `SELECT stripe_deleted_at FROM connected_accounts WHERE user_id = $1`,
        [userId],
      );
      expect(done[0].stripe_deleted_at).not.toBeNull();
    });
  });

  it('exports the payout account', async () => {
    const { userId, accessToken } = await lender();
    const empty = await service.send(PaymentsRpc.exportMe, {}, { accessToken });
    expect(empty.payoutAccount).toBeNull();

    await onboard(accessToken);
    const exported = await service.send(
      PaymentsRpc.exportMe,
      {},
      {
        accessToken,
      },
    );
    expect(exported.payoutAccount).toMatchObject({
      stripeAccountId: await accountIdOf(userId),
      status: 'INCOMPLETE',
      payoutsEnabled: false,
    });
  });
});
