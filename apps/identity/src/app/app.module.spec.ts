import { generateKeyPairSync } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { Client } from 'pg';
import type { DataSource } from 'typeorm';
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
import { DATA_SOURCE, MIGRATIONS } from './database/database.module';

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
  let app: TestingModule;
  let dataSource: DataSource;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    [pg, rabbit] = await Promise.all([startPostgres(), startRabbitMq()]);
    const { publicKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    Object.assign(process.env, {
      DATABASE_URL: pg.urlFor('identity'),
      RABBITMQ_URL: rabbit.url,
      DB_MIGRATIONS_RUN: 'true',
      JWT_PUBLIC_KEY: publicKey,
      JWT_KEY_ID: 'test-key',
    });

    // ConfigModule.forRoot validates env when app.module is first imported,
    // so import it only after the containers' URLs are in process.env.
    const { AppModule } = await import('./app.module');
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init(); // runs onApplicationBootstrap → relay starts
    dataSource = app.get<DataSource>(DATA_SOURCE);
  });

  afterAll(async () => {
    await app?.close();
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
    expect(await dataSource.showMigrations()).toBe(false);
    expect(MIGRATIONS).toHaveLength(2);
  });

  it('enforces case-insensitive unique emails and the display-name rule', async () => {
    await dataSource.query(
      `INSERT INTO users (email, display_name) VALUES ('Ana@Example.com', 'Ana')`,
    );
    await expect(
      dataSource.query(
        `INSERT INTO users (email, display_name) VALUES ('ana@example.COM', 'Other')`,
      ),
    ).rejects.toThrow(/users_email_lower_key/);
    await expect(
      dataSource.query(
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
      await dataSource.transaction((tx) => addToOutbox(tx, envelope));

      await expect(received).resolves.toMatchObject({
        eventId: envelope.eventId,
        type: 'user.deletion_requested',
        correlationId: 'test-flow',
      });
    } finally {
      await bus.close();
    }
  });
});
