import { randomUUID } from 'node:crypto';
import {
  createEnvelope,
  UserDeletionRequestedV1,
  UserProfileUpdatedV1,
  UserRegisteredV1,
  type EventEnvelope,
} from '@borrowbox/contracts';
import { EventBus, type MessagingLogger } from '@borrowbox/messaging';
import {
  startPostgres,
  startRabbitMq,
  startRedis,
  type TestPostgres,
  type TestRabbitMq,
  type TestRedis,
} from '@borrowbox/testing';
import {
  startCatalog,
  type CatalogHarness,
} from '../../testing/catalog-harness';
import { EventsModule } from '../events/events.module';
import { USER_EVENTS_QUEUE, UserEventsConsumer } from './user-events.consumer';

const silent: MessagingLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Identity's user events, published to a real RabbitMQ, as they reach
 * Catalog's consumer and its Postgres schema.
 */
describe('User events consumer (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let redis: TestRedis;
  let catalog: CatalogHarness;
  let bus: EventBus;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    [pg, rabbit, redis] = await Promise.all([
      startPostgres(),
      startRabbitMq(),
      startRedis(),
    ]);
    catalog = await startCatalog({
      databaseUrl: pg.urlFor('catalog'),
      rabbitmqUrl: rabbit.url,
      redisUrl: redis.url,
    });
    bus = await EventBus.connect({ url: rabbit.url, logger: silent });
  });

  afterAll(async () => {
    await bus?.close();
    await catalog?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop(), redis?.stop()]);
  });

  const at = (minute: number) => ({
    occurredAt: new Date(Date.UTC(2026, 9, 7, 12, minute)),
  });

  const registered = (userId: string, displayName: string, minute = 0) =>
    createEnvelope(
      UserRegisteredV1,
      { userId, email: 'private@example.com', displayName, locale: 'el' },
      at(minute),
    );
  const renamed = (userId: string, displayName: string, minute: number) =>
    createEnvelope(
      UserProfileUpdatedV1,
      { userId, displayName, locale: 'en' },
      at(minute),
    );
  const deleted = (userId: string, minute: number) =>
    createEnvelope(UserDeletionRequestedV1, { userId }, at(minute));

  /** Publishes through the broker and waits until Catalog has handled it. */
  async function deliver(envelope: EventEnvelope): Promise<void> {
    await bus.publish(envelope);
    const deadline = Date.now() + 15_000;
    for (;;) {
      const rows = await catalog.dataSource.query(
        `SELECT 1 FROM processed_events WHERE consumer = $1 AND event_id = $2`,
        [USER_EVENTS_QUEUE, envelope.eventId],
      );
      if (rows.length > 0) return;
      if (Date.now() > deadline) {
        throw new Error(`${envelope.type} was not handled in time`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async function lender(userId: string) {
    const [row] = await catalog.dataSource.query(
      `SELECT display_name, deleted_at FROM lenders WHERE user_id = $1`,
      [userId],
    );
    return row as
      { display_name: string | null; deleted_at: Date | null } | undefined;
  }

  async function insertItem(
    lenderId: string,
    columns: Record<string, unknown> = {},
  ): Promise<string> {
    const row = {
      title: 'Cordless drill',
      description: 'With two batteries',
      category: 'tools',
      free: true,
      deposit_cents: 0,
      ...columns,
    };
    const [{ id }] = await catalog.dataSource.query(
      `INSERT INTO items (lender_id, ${Object.keys(row).join(', ')})
       VALUES ($1, ${Object.keys(row)
         .map((_, i) => `$${i + 2}`)
         .join(', ')})
       RETURNING id`,
      [lenderId, ...Object.values(row)],
    );
    return id;
  }

  it('keeps the name of a registered user, and nothing else', async () => {
    const userId = randomUUID();
    await deliver(registered(userId, 'Maria'));
    expect(await lender(userId)).toEqual({
      display_name: 'Maria',
      deleted_at: null,
    });
    const [{ found }] = await catalog.dataSource.query(
      `SELECT count(*)::int AS found FROM lenders l
        WHERE row_to_json(l)::text LIKE '%private@example.com%'`,
    );
    expect(found).toBe(0);
  });

  it('applies a newer name, and ignores an older one arriving late', async () => {
    const userId = randomUUID();
    await deliver(registered(userId, 'Maria', 0));
    await deliver(renamed(userId, 'Maria P.', 10));
    expect((await lender(userId))?.display_name).toBe('Maria P.');

    await deliver(renamed(userId, 'Old name', 5));
    expect((await lender(userId))?.display_name).toBe('Maria P.');
  });

  it('creates the row from a profile update if the registration was missed', async () => {
    const userId = randomUUID();
    await deliver(renamed(userId, 'Nikos', 1));
    expect((await lender(userId))?.display_name).toBe('Nikos');
  });

  it('erases a deleted account: name, items, and one item.deleted per item', async () => {
    const userId = randomUUID();
    await deliver(registered(userId, 'Eleni'));
    const draft = await insertItem(userId);
    const active = await insertItem(userId, {
      status: 'ACTIVE',
      published_at: new Date(),
      location: 'SRID=4326;POINT(23.7275 37.9838)',
      location_public: 'SRID=4326;POINT(23.7290 37.9852)',
      offset_m: 200,
      offset_bearing: 45,
    });
    const longGone = await insertItem(userId, {
      status: 'DELETED',
      description: '',
      deleted_at: new Date('2026-01-01T00:00:00Z'),
    });
    const someoneElses = await insertItem(randomUUID());

    const deletion = deleted(userId, 30);
    await deliver(deletion);

    expect(await lender(userId)).toEqual({
      display_name: null,
      deleted_at: expect.any(Date),
    });
    const items = await catalog.dataSource.query(
      `SELECT id, status, description, location, location_public, offset_m, deleted_at
         FROM items WHERE id = ANY($1)`,
      [[draft, active, longGone, someoneElses]],
    );
    const byId = Object.fromEntries(
      items.map((i: { id: string }) => [i.id, i]),
    );
    for (const id of [draft, active]) {
      expect(byId[id]).toMatchObject({
        status: 'DELETED',
        description: '',
        location: null,
        location_public: null,
        offset_m: null,
      });
    }
    expect(byId[longGone].deleted_at).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(byId[someoneElses].status).toBe('DRAFT');

    const events = await catalog.dataSource.query(
      `SELECT envelope FROM outbox WHERE routing_key = 'item.deleted.v1'
         AND envelope->>'causationId' = $1`,
      [deletion.eventId],
    );
    expect(
      events.map((e: { envelope: EventEnvelope }) => e.envelope.payload),
    ).toEqual(
      expect.arrayContaining([
        { itemId: draft, lenderId: userId },
        { itemId: active, lenderId: userId },
      ]),
    );
    expect(events).toHaveLength(2);
    expect(events[0].envelope.correlationId).toBe(deletion.correlationId);
  });

  it('handles the same event only once', async () => {
    const userId = randomUUID();
    await insertItem(userId);
    const deletion = deleted(userId, 0);
    await deliver(deletion);
    // A redelivery, e.g. after a lost ack.
    await catalog.app
      .get(UserEventsConsumer)
      .handle(deletion, UserDeletionRequestedV1.routingKey);
    const [{ count }] = await catalog.dataSource.query(
      `SELECT count(*)::int AS count FROM outbox
        WHERE envelope->>'causationId' = $1`,
      [deletion.eventId],
    );
    expect(count).toBe(1);
  });

  it('never brings a deleted user back, whatever arrives later', async () => {
    const userId = randomUUID();
    // The deletion overtakes the registration.
    await deliver(deleted(userId, 20));
    await deliver(registered(userId, 'Kostas', 0));
    await deliver(renamed(userId, 'Kostas K.', 40));
    expect(await lender(userId)).toEqual({
      display_name: null,
      deleted_at: expect.any(Date),
    });
  });

  it('rejects an invalid payload without changing anything', async () => {
    const userId = randomUUID();
    const envelope = registered(userId, '');
    await expect(
      catalog.app
        .get(UserEventsConsumer)
        .handle(envelope, UserRegisteredV1.routingKey),
    ).rejects.toThrow('Invalid user.registered event: payload.displayName');
    expect(await lender(userId)).toBeUndefined();
    const processed = await catalog.dataSource.query(
      `SELECT 1 FROM processed_events WHERE event_id = $1`,
      [envelope.eventId],
    );
    expect(processed).toHaveLength(0);
  });

  it('prunes old processed_events entries', async () => {
    const [old, recent] = [randomUUID(), randomUUID()];
    await catalog.dataSource.query(
      `INSERT INTO processed_events (consumer, event_id, processed_at)
       VALUES ('test', $1, now() - interval '8 days'), ('test', $2, now())`,
      [old, recent],
    );
    await catalog.app.get(EventsModule).pruneProcessedEvents();
    const rows = await catalog.dataSource.query(
      `SELECT event_id FROM processed_events WHERE consumer = 'test'`,
    );
    expect(rows).toEqual([{ event_id: recent }]);
  });
});
