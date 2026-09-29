import { DataSource } from 'typeorm';
import { createEnvelope, defineEvent } from '@borrowbox/contracts';
import { EventBus, type MessagingLogger } from '@borrowbox/messaging';
import {
  startPostgres,
  startRabbitMq,
  type TestPostgres,
  type TestRabbitMq,
} from '@borrowbox/testing';
import { handleOnce } from './idempotent-consumer';
import { CreateOutboxTables1759140000000 } from './migration';
import { addToOutbox } from './outbox';
import { OutboxRelay } from './relay';

const ItemCreatedV1 = defineEvent<{ itemId: string; title: string }>()(
  'item.created',
  1,
);
const silent: MessagingLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Full path with no mocks: catalog writes state + outbox in one transaction,
 * the relay publishes to RabbitMQ, and bookings builds a read model in its own
 * schema through an idempotent consumer.
 */
describe('outbox → RabbitMQ → idempotent consumer', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let catalog: DataSource;
  let bookings: DataSource;
  let bus: EventBus;
  let relay: OutboxRelay;

  const serviceDataSource = async (url: string) => {
    const ds = new DataSource({
      type: 'postgres',
      url,
      migrations: [CreateOutboxTables1759140000000],
    });
    await ds.initialize();
    await ds.runMigrations();
    return ds;
  };

  beforeAll(async () => {
    [pg, rabbit] = await Promise.all([startPostgres(), startRabbitMq()]);
    catalog = await serviceDataSource(pg.urlFor('catalog'));
    bookings = await serviceDataSource(pg.urlFor('bookings'));
    await catalog.query(
      `CREATE TABLE items (id text PRIMARY KEY, title text NOT NULL)`,
    );
    await bookings.query(
      `CREATE TABLE item_read_model (item_id text PRIMARY KEY, title text NOT NULL, times_applied int NOT NULL)`,
    );

    bus = await EventBus.connect({ url: rabbit.url, logger: silent });
    relay = new OutboxRelay({
      dataSource: catalog,
      publish: (e) => bus.publish(e),
      pollIntervalMs: 20,
    });
  });

  afterAll(async () => {
    await relay?.stop();
    await bus?.close();
    await catalog?.destroy();
    await bookings?.destroy();
    await Promise.all([pg?.stop(), rabbit?.stop()]);
  });

  it('delivers the event and applies it once even when delivered twice', async () => {
    const consumer = 'bookings.item-events';
    let deliveries = 0;
    await bus.subscribe({
      queue: consumer,
      routingKeys: [ItemCreatedV1.routingKey],
      handler: async (envelope) => {
        deliveries++;
        const { itemId, title } = envelope.payload as {
          itemId: string;
          title: string;
        };
        await handleOnce(bookings, consumer, envelope, async (tx) => {
          await tx.query(
            `INSERT INTO item_read_model (item_id, title, times_applied) VALUES ($1, $2, 1)
             ON CONFLICT (item_id) DO UPDATE SET times_applied = item_read_model.times_applied + 1`,
            [itemId, title],
          );
        });
      },
    });

    const env = createEnvelope(ItemCreatedV1, {
      itemId: 'drill-1',
      title: 'Cordless drill',
    });
    await catalog.transaction(async (tx) => {
      await tx.query(`INSERT INTO items (id, title) VALUES ($1, $2)`, [
        'drill-1',
        'Cordless drill',
      ]);
      await addToOutbox(tx, env);
    });

    relay.start();
    const waitFor = async (cond: () => boolean) => {
      for (let i = 0; i < 200 && !cond(); i++)
        await new Promise((r) => setTimeout(r, 25));
      expect(cond()).toBe(true);
    };
    await waitFor(() => deliveries >= 1);

    // Simulate at-least-once redelivery (e.g. relay crashed before marking the row published).
    await bus.publish(env);
    await waitFor(() => deliveries >= 2);

    const rows = await bookings.query(
      `SELECT item_id, title, times_applied FROM item_read_model`,
    );
    expect(rows).toEqual([
      { item_id: 'drill-1', title: 'Cordless drill', times_applied: 1 },
    ]);

    const [outbox] = await catalog.query(`SELECT published_at FROM outbox`);
    expect(outbox.published_at).not.toBeNull();
  });
});
