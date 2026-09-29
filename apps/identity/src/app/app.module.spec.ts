import { Client } from 'pg';
import {
  createEnvelope,
  UserDeletionRequestedV1,
  type EventEnvelope,
} from '@borrowbox/contracts';
import { EventBus, type MessagingLogger } from '@borrowbox/messaging';
import { addToOutbox } from '@borrowbox/outbox';
import {
  startPostgres,
  startRabbitMq,
  type TestPostgres,
  type TestRabbitMq,
} from '@borrowbox/testing';
import {
  startIdentity,
  type IdentityHarness,
} from '../testing/identity-harness';
import { MIGRATIONS } from './database/database.module';

const silent: MessagingLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Boots the real AppModule against Postgres (identity_svc role) and RabbitMQ:
 * migrations run into the `identity` schema, and an event written to the
 * outbox reaches the broker through the relay.
 */
describe('Identity AppModule (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let identity: IdentityHarness;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    [pg, rabbit] = await Promise.all([startPostgres(), startRabbitMq()]);
    identity = await startIdentity({
      databaseUrl: pg.urlFor('identity'),
      rabbitmqUrl: rabbit.url,
    });
  });

  afterAll(async () => {
    await identity?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop()]);
  });

  it('migrates into the identity schema only', async () => {
    const admin = new Client({ connectionString: pg.adminUrl });
    await admin.connect();
    try {
      const { rows } = await admin.query<{
        table_schema: string;
        table_name: string;
      }>(
        `SELECT table_schema, table_name FROM information_schema.tables
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'public', 'tiger', 'tiger_data', 'topology')
          ORDER BY table_name`,
      );
      expect(rows).toEqual(
        [
          'migrations',
          'oauth_identities',
          'outbox',
          'processed_events',
          'refresh_tokens',
          'users',
        ].map((table_name) => ({ table_schema: 'identity', table_name })),
      );
    } finally {
      await admin.end();
    }
    // Idempotent: nothing left to run.
    expect(await identity.dataSource.showMigrations()).toBe(false);
    expect(MIGRATIONS).toHaveLength(2);
  });

  it('enforces case-insensitive unique emails and the display-name rule', async () => {
    await identity.dataSource.query(
      `INSERT INTO users (email, display_name) VALUES ('Ana@Example.com', 'Ana')`,
    );
    await expect(
      identity.dataSource.query(
        `INSERT INTO users (email, display_name) VALUES ('ana@example.COM', 'Other')`,
      ),
    ).rejects.toThrow(/users_email_lower_key/);
    await expect(
      identity.dataSource.query(
        `INSERT INTO users (email) VALUES ('no-name@example.com')`,
      ),
    ).rejects.toThrow(/users_display_name_present/);
  });

  it('publishes outbox events to RabbitMQ through the relay', async () => {
    const bus = await EventBus.connect({ url: rabbit.url, logger: silent });
    try {
      let deliver!: (envelope: EventEnvelope) => void;
      const received = new Promise<EventEnvelope>((r) => (deliver = r));
      // Resolves once the queue is declared and bound.
      await bus.subscribe({
        queue: 'test.identity-events',
        routingKeys: [UserDeletionRequestedV1.routingKey],
        handler: async (envelope) => deliver(envelope),
      });

      const envelope = createEnvelope(
        UserDeletionRequestedV1,
        { userId: '00000000-0000-4000-8000-000000000001' },
        { correlationId: 'test-flow' },
      );
      await identity.dataSource.transaction((tx) => addToOutbox(tx, envelope));

      await expect(received).resolves.toMatchObject({
        eventId: envelope.eventId,
        type: 'user.deletion_requested',
        correlationId: 'test-flow',
      });
    } finally {
      await bus.close();
    }
  });

  it('answers unexpected failures with a generic INTERNAL error', async () => {
    await identity.dataSource.query(`ALTER TABLE users RENAME TO users_tmp`);
    try {
      await expect(
        identity.send('identity.login', {
          email: 'x@example.com',
          password: 'whatever1',
        }),
      ).rejects.toEqual({ code: 'INTERNAL', message: 'Internal error' });
    } finally {
      await identity.dataSource.query(`ALTER TABLE users_tmp RENAME TO users`);
    }
  });
});
