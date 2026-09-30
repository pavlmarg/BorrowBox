import { DataSource } from 'typeorm';
import {
  createEnvelope,
  defineEvent,
  type EventEnvelope,
} from '@borrowbox/contracts';
import { startPostgres, type TestPostgres } from '@borrowbox/testing';
import { handleOnce, pruneProcessedEvents } from './idempotent-consumer';
import { CreateOutboxTables1759140000000 } from './migration';
import { addToOutbox } from './outbox';
import { OutboxRelay, relayDelayMs, type OutboxLogger } from './relay';

const ItemCreatedV1 = defineEvent<{ itemId: string }>()('item.created', 1);
const silent: OutboxLogger = { warn: () => undefined, error: () => undefined };

describe('outbox (Postgres integration)', () => {
  let pg: TestPostgres;
  let ds: DataSource;

  beforeAll(async () => {
    pg = await startPostgres();
    ds = new DataSource({
      type: 'postgres',
      url: pg.urlFor('catalog'),
      migrations: [CreateOutboxTables1759140000000],
    });
    await ds.initialize();
    await ds.runMigrations();
    await ds.query(`CREATE TABLE items (id text PRIMARY KEY)`);
  });

  afterAll(async () => {
    await ds?.destroy();
    await pg?.stop();
  });

  beforeEach(async () => {
    await ds.query(`TRUNCATE outbox, processed_events, items`);
  });

  const newEvent = (itemId: string) =>
    createEnvelope(ItemCreatedV1, { itemId });

  /** Simulates a service command: state change + event in one transaction. */
  const createItem = (env: EventEnvelope<{ itemId: string }>) =>
    ds.transaction(async (tx) => {
      await tx.query(`INSERT INTO items (id) VALUES ($1)`, [
        env.payload.itemId,
      ]);
      await addToOutbox(tx, env);
    });

  const outboxRows = (): Promise<
    Array<{
      event_id: string;
      published_at: Date | null;
      attempts: number;
      last_error: string | null;
    }>
  > =>
    ds.query(
      `SELECT event_id, published_at, attempts, last_error FROM outbox ORDER BY id`,
    );

  describe('migration', () => {
    it('creates the tables in the service schema', async () => {
      const [row] = await ds.query(
        `SELECT to_regclass('catalog.outbox') AS o, to_regclass('catalog.processed_events') AS p`,
      );
      expect(row).toEqual({ o: 'outbox', p: 'processed_events' });
    });
  });

  describe('addToOutbox', () => {
    it('writes the event with its routing key in the same transaction', async () => {
      const env = newEvent('i-1');
      await createItem(env);

      const [row] = await ds.query(`SELECT routing_key, envelope FROM outbox`);
      expect(row.routing_key).toBe('item.created.v1');
      expect(row.envelope).toEqual(env);
    });

    it('rolls back with the state change', async () => {
      await expect(
        ds.transaction(async (tx) => {
          await tx.query(`INSERT INTO items (id) VALUES ('i-2')`);
          await addToOutbox(tx, newEvent('i-2'));
          throw new Error('business rule failed');
        }),
      ).rejects.toThrow('business rule failed');

      expect(await ds.query(`SELECT * FROM items`)).toEqual([]);
      expect(await outboxRows()).toEqual([]);
    });

    it('refuses to run outside a transaction', async () => {
      await expect(addToOutbox(ds.manager, newEvent('i-3'))).rejects.toThrow(
        /inside the transaction/,
      );
    });
  });

  describe('OutboxRelay', () => {
    it('publishes pending events in order and marks them published', async () => {
      const events = ['a', 'b', 'c'].map(newEvent);
      for (const e of events) await createItem(e);

      const published: string[] = [];
      const relay = new OutboxRelay({
        dataSource: ds,
        publish: async (e) => void published.push(e.eventId),
        logger: silent,
      });

      expect(await relay.publishPending()).toBe(3);
      expect(published).toEqual(events.map((e) => e.eventId));
      expect((await outboxRows()).every((r) => r.published_at !== null)).toBe(
        true,
      );

      expect(await relay.publishPending()).toBe(0);
      expect(published).toHaveLength(3);
    });

    it('stops at the first failure, records it, and resumes in order', async () => {
      const events = ['a', 'b', 'c'].map(newEvent);
      for (const e of events) await createItem(e);

      const published: string[] = [];
      let brokerDown = true;
      const relay = new OutboxRelay({
        dataSource: ds,
        logger: silent,
        publish: async (e) => {
          if (e.eventId === events[1].eventId && brokerDown) {
            throw new Error('broker unavailable');
          }
          published.push(e.eventId);
        },
      });

      expect(await relay.publishPending()).toBe(1);
      const rows = await outboxRows();
      expect(rows[1]).toMatchObject({
        published_at: null,
        attempts: 1,
        last_error: 'broker unavailable',
      });
      expect(rows[2].published_at).toBeNull();

      brokerDown = false;
      expect(await relay.publishPending()).toBe(2);
      expect(published).toEqual(events.map((e) => e.eventId));
      expect((await outboxRows())[1].last_error).toBeNull();
    });

    it('never publishes a row twice when relays run concurrently', async () => {
      const events = Array.from({ length: 40 }, (_, i) => newEvent(`i-${i}`));
      for (const e of events) await createItem(e);

      const published: string[] = [];
      const makeRelay = () =>
        new OutboxRelay({
          dataSource: ds,
          batchSize: 5,
          logger: silent,
          publish: async (e) => {
            await new Promise((r) => setTimeout(r, 2));
            published.push(e.eventId);
          },
        });
      const drain = async (relay: OutboxRelay) => {
        while ((await relay.publishPending()) > 0) {
          /* keep draining */
        }
      };

      await Promise.all([
        drain(makeRelay()),
        drain(makeRelay()),
        drain(makeRelay()),
      ]);

      expect(published).toHaveLength(40);
      expect(new Set(published).size).toBe(40);
    });

    it('start/stop polls in the background', async () => {
      const published: string[] = [];
      const relay = new OutboxRelay({
        dataSource: ds,
        pollIntervalMs: 20,
        logger: silent,
        publish: async (e) => void published.push(e.eventId),
      });
      relay.start();
      const env = newEvent('bg');
      await createItem(env);

      for (let i = 0; i < 100 && published.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      await relay.stop();
      expect(published).toEqual([env.eventId]);
    });

    it('prunes published rows past the retention period, never unpublished ones', async () => {
      const [old, recent, pending] = ['old', 'recent', 'pending'].map(newEvent);
      for (const e of [old, recent, pending]) await createItem(e);
      await ds.query(
        `UPDATE outbox SET published_at = now() - interval '8 days'
          WHERE event_id = $1`,
        [old.eventId],
      );
      await ds.query(
        `UPDATE outbox SET published_at = now() - interval '1 day'
          WHERE event_id = $1`,
        [recent.eventId],
      );
      await ds.query(
        `UPDATE outbox SET created_at = now() - interval '30 days'
          WHERE event_id = $1`,
        [pending.eventId],
      );

      // The loop prunes on its first iteration; publishing fails meanwhile,
      // so the pending row stays unpublished.
      const relay = new OutboxRelay({
        dataSource: ds,
        pollIntervalMs: 20,
        logger: silent,
        publish: async () => {
          throw new Error('broker unavailable');
        },
      });
      relay.start();
      await new Promise((r) => setTimeout(r, 200));
      await relay.stop();

      expect((await outboxRows()).map((r) => r.event_id)).toEqual([
        recent.eventId,
        pending.eventId,
      ]);
      expect(await relay.prunePublished()).toBe(0);
    });

    it('backs off while publishing keeps failing, then recovers at the normal pace', async () => {
      const events = ['a', 'b'].map(newEvent);
      for (const e of events) await createItem(e);

      let brokerDown = true;
      let attempts = 0;
      const published: string[] = [];
      const relay = new OutboxRelay({
        dataSource: ds,
        pollIntervalMs: 20,
        maxBackoffMs: 200,
        logger: silent,
        publish: async (e) => {
          attempts++;
          if (brokerDown) throw new Error('broker unavailable');
          published.push(e.eventId);
        },
      });
      relay.start();
      await new Promise((r) => setTimeout(r, 1_000));

      // Without backoff: ~50 attempts in 1 s at a 20 ms poll.
      // With it (20, 40, 80, 160, 200, 200…ms): about 8.
      expect(attempts).toBeGreaterThanOrEqual(3);
      expect(attempts).toBeLessThan(15);
      expect(published).toHaveLength(0);

      brokerDown = false;
      // Within one max backoff, then everything goes out in order.
      for (let i = 0; i < 50 && published.length < 2; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      await relay.stop();
      expect(published).toEqual(events.map((e) => e.eventId));
    });

    it('logs a row as an error once it has failed alertAfterAttempts times', async () => {
      await createItem(newEvent('stuck'));
      const warn = jest.fn();
      const error = jest.fn();
      const relay = new OutboxRelay({
        dataSource: ds,
        alertAfterAttempts: 3,
        logger: { warn, error },
        publish: async () => {
          throw new Error('broker unavailable');
        },
      });

      for (let i = 0; i < 3; i++) await relay.publishPending();

      expect(warn).toHaveBeenCalledTimes(2);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toMatchObject({ attempts: 3 });
      // Logs identify the event, never its payload.
      expect(JSON.stringify(error.mock.calls[0][0])).not.toContain('stuck');
    });
  });

  describe('relayDelayMs', () => {
    it('doubles per consecutive failure up to the cap, and resets to the poll interval', () => {
      expect(relayDelayMs(0, 500, 30_000)).toBe(500);
      expect([1, 2, 3, 4].map((n) => relayDelayMs(n, 500, 30_000))).toEqual([
        1_000, 2_000, 4_000, 8_000,
      ]);
      expect(relayDelayMs(6, 500, 30_000)).toBe(30_000);
      expect(relayDelayMs(10_000, 500, 30_000)).toBe(30_000);
      // A cap below the poll interval never makes polling faster.
      expect(relayDelayMs(3, 500, 100)).toBe(500);
    });
  });

  describe('pruneProcessedEvents', () => {
    it('deletes entries older than the retention period', async () => {
      await ds.query(
        `INSERT INTO processed_events (consumer, event_id, processed_at) VALUES
           ('c', gen_random_uuid(), now() - interval '8 days'),
           ('c', gen_random_uuid(), now() - interval '1 day')`,
      );
      expect(await pruneProcessedEvents(ds)).toBe(1);
      expect(
        (await ds.query(`SELECT count(*)::int AS n FROM processed_events`))[0]
          .n,
      ).toBe(1);
    });
  });

  describe('handleOnce', () => {
    const consumer = 'catalog.test-consumer';
    const countItems = async () =>
      Number((await ds.query(`SELECT count(*)::int AS n FROM items`))[0].n);

    it('applies the same event only once', async () => {
      const env = newEvent('dup');
      const apply = (tx: import('typeorm').EntityManager) =>
        tx
          .query(`INSERT INTO items (id) VALUES ($1)`, [env.payload.itemId])
          .then(() => undefined);

      expect(await handleOnce(ds, consumer, env, apply)).toBe(true);
      expect(await handleOnce(ds, consumer, env, apply)).toBe(false);
      expect(await countItems()).toBe(1);
    });

    it('tracks each consumer separately', async () => {
      const env = newEvent('shared');
      let runs = 0;
      const apply = async () => void runs++;
      await handleOnce(ds, 'catalog.consumer-a', env, apply);
      await handleOnce(ds, 'catalog.consumer-b', env, apply);
      await handleOnce(ds, 'catalog.consumer-a', env, apply);
      expect(runs).toBe(2);
    });

    it('does not record the event when the side effect fails', async () => {
      const env = newEvent('flaky');
      await expect(
        handleOnce(ds, consumer, env, async (tx) => {
          await tx.query(`INSERT INTO items (id) VALUES ('flaky')`);
          throw new Error('downstream failure');
        }),
      ).rejects.toThrow('downstream failure');
      expect(await countItems()).toBe(0);

      // A redelivery can then succeed.
      expect(
        await handleOnce(ds, consumer, env, async (tx) => {
          await tx.query(`INSERT INTO items (id) VALUES ('flaky')`);
        }),
      ).toBe(true);
      expect(await countItems()).toBe(1);
    });

    it('applies once under concurrent duplicate deliveries', async () => {
      const env = newEvent('race');
      let runs = 0;
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          handleOnce(ds, consumer, env, async () => {
            runs++;
            await new Promise((r) => setTimeout(r, 20));
          }),
        ),
      );
      expect(runs).toBe(1);
      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });
});
