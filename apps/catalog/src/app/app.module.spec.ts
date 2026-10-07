import { Client } from 'pg';
import {
  CatalogRpc,
  createEnvelope,
  ItemDeletedV1,
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
import { startCatalog, type CatalogHarness } from '../testing/catalog-harness';
import { MIGRATIONS } from './database/database.module';

const silent: MessagingLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Boots the real AppModule against Postgres (catalog_svc role) and RabbitMQ:
 * migrations run into the `catalog` schema, and an event written to the
 * outbox reaches the broker through the relay.
 */
describe('Catalog AppModule (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let catalog: CatalogHarness;
  const savedEnv = { ...process.env };

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

  it('migrates into the catalog schema only', async () => {
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
          'item_photos',
          'items',
          'lenders',
          'migrations',
          'outbox',
          'processed_events',
        ].map((table_name) => ({
          table_schema: 'catalog',
          table_name,
        })),
      );
    } finally {
      await admin.end();
    }
    // Idempotent: nothing left to run.
    expect(await catalog.dataSource.showMigrations()).toBe(false);
    expect(MIGRATIONS).toHaveLength(2);
  });

  it('publishes outbox events to RabbitMQ through the relay', async () => {
    const bus = await EventBus.connect({ url: rabbit.url, logger: silent });
    try {
      let deliver!: (envelope: EventEnvelope) => void;
      const received = new Promise<EventEnvelope>((r) => (deliver = r));
      // Resolves once the queue is declared and bound.
      await bus.subscribe({
        queue: 'test.catalog-events',
        routingKeys: [ItemDeletedV1.routingKey],
        handler: async (envelope) => deliver(envelope),
      });

      const envelope = createEnvelope(
        ItemDeletedV1,
        {
          itemId: '00000000-0000-4000-8000-000000000002',
          lenderId: '00000000-0000-4000-8000-000000000001',
        },
        { correlationId: 'test-flow' },
      );
      await catalog.dataSource.transaction((tx) => addToOutbox(tx, envelope));

      await expect(received).resolves.toMatchObject({
        eventId: envelope.eventId,
        type: 'item.deleted',
        correlationId: 'test-flow',
      });
    } finally {
      await bus.close();
    }
  });

  it('answers a pattern it has no handler for with an error', async () => {
    // Nest's TCP server replies at once with a plain string (not an
    // RpcErrorBody); the gateway logs it and answers 500 INTERNAL.
    await expect(
      catalog.send(CatalogRpc.createPhotoUpload, {}),
    ).rejects.toMatch(/no matching message handler/i);
  });
});
