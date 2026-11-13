import { randomUUID } from 'node:crypto';
import {
  BookingsRpc,
  createEnvelope,
  ItemCreatedV1,
  ItemDeletedV1,
  ItemUpdatedV1,
  UserDeletionRequestedV1,
  UserEmailVerifiedV1,
  UserProfileUpdatedV1,
  UserRegisteredV1,
  type EventEnvelope,
  type ItemSnapshotV1,
} from '@borrowbox/contracts';
import { EventBus, type MessagingLogger } from '@borrowbox/messaging';
import { InvalidEventError } from '@borrowbox/service-kit';
import {
  startPostgres,
  startRabbitMq,
  startRedis,
  type TestPostgres,
  type TestRabbitMq,
  type TestRedis,
} from '@borrowbox/testing';
import {
  startBookings,
  type BookingsHarness,
} from '../../testing/bookings-harness';
import { ITEM_EVENTS_QUEUE } from './item-events.consumer';
import { USER_EVENTS_QUEUE } from './user-events.consumer';

const silent: MessagingLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const HOUR = 60 * 60 * 1000;
const at = (hours: number) =>
  new Date(Math.ceil(Date.now() / HOUR) * HOUR + hours * HOUR).toISOString();

/**
 * Catalog's and Identity's events, published to a real RabbitMQ, as they
 * reach Bookings' consumers and its Postgres schema.
 */
describe('Read model consumers (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let redis: TestRedis;
  let bookings: BookingsHarness;
  let bus: EventBus;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    [pg, rabbit, redis] = await Promise.all([
      startPostgres(),
      startRabbitMq(),
      startRedis(),
    ]);
    bookings = await startBookings({
      databaseUrl: pg.urlFor('bookings'),
      rabbitmqUrl: rabbit.url,
      redisUrl: redis.url,
    });
    bus = await EventBus.connect({ url: rabbit.url, logger: silent });
  });

  afterAll(async () => {
    await bus?.close();
    await bookings?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop(), redis?.stop()]);
  });

  const minute = (m: number) => ({
    occurredAt: new Date(Date.UTC(2026, 9, 21, 12, m)),
  });

  /** Publishes through the broker and waits until Bookings has handled it. */
  async function deliver(envelope: EventEnvelope): Promise<void> {
    const consumer = envelope.type.startsWith('item.')
      ? ITEM_EVENTS_QUEUE
      : USER_EVENTS_QUEUE;
    await bus.publish(envelope);
    const deadline = Date.now() + 15_000;
    for (;;) {
      const rows = await bookings.dataSource.query(
        `SELECT 1 FROM processed_events WHERE consumer = $1 AND event_id = $2`,
        [consumer, envelope.eventId],
      );
      if (rows.length > 0) return;
      if (Date.now() > deadline) {
        throw new Error(`${envelope.type} was not handled in time`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const item = (overrides: Partial<ItemSnapshotV1> = {}): ItemSnapshotV1 => ({
    itemId: randomUUID(),
    lenderId: randomUUID(),
    title: 'Ladder',
    category: 'diy-ladders',
    pricing: { free: false, dailyCents: 800 },
    depositCents: 0,
    minRentalHours: null,
    maxRentalHours: 48,
    status: 'ACTIVE',
    ...overrides,
  });

  async function storedItem(itemId: string) {
    const [row] = await bookings.dataSource.query(
      `SELECT title, pricing, status, max_rental_hours FROM items WHERE item_id = $1`,
      [itemId],
    );
    return row;
  }

  async function storedUser(userId: string) {
    const [row] = await bookings.dataSource.query(
      `SELECT display_name, photo, email_verified_at, deleted_at FROM users WHERE user_id = $1`,
      [userId],
    );
    return row;
  }

  describe('items', () => {
    it('keeps the newest snapshot, whatever order events arrive in', async () => {
      const v1 = item();
      await deliver(
        createEnvelope(ItemUpdatedV1, { ...v1, title: 'New' }, minute(5)),
      );
      await deliver(createEnvelope(ItemCreatedV1, v1, minute(1)));
      expect(await storedItem(v1.itemId)).toEqual({
        title: 'New',
        pricing: { free: false, dailyCents: 800 },
        status: 'ACTIVE',
        max_rental_hours: 48,
      });
    });

    it('keeps a deletion final, even for an item it never saw', async () => {
      const gone = item();
      await deliver(
        createEnvelope(
          ItemDeletedV1,
          { itemId: gone.itemId, lenderId: gone.lenderId },
          minute(1),
        ),
      );
      await deliver(createEnvelope(ItemCreatedV1, gone, minute(9)));
      expect((await storedItem(gone.itemId)).status).toBe('DELETED');
    });

    it('cancels open bookings once when item.deleted arrives twice', async () => {
      const lender = await bookings.addUser();
      const renter = await bookings.addUser();
      const bookable = await bookings.addItem(lender);
      const booking = await bookings.send(
        BookingsRpc.request,
        {
          bookingId: randomUUID(),
          itemId: bookable.itemId,
          start: at(2),
          end: at(3),
        },
        { accessToken: await bookings.tokenFor(renter) },
      );

      const deleted = createEnvelope(ItemDeletedV1, {
        itemId: bookable.itemId,
        lenderId: lender,
      });
      await deliver(deleted);
      // A redelivery, awaited to the end.
      await bookings.receive(deleted);

      const rows = await bookings.dataSource.query(
        `SELECT envelope->>'causationId' AS cause FROM outbox
          WHERE routing_key = 'booking.cancelled.v1'
            AND envelope->'payload'->>'bookingId' = $1`,
        [booking.id],
      );
      expect(rows).toEqual([{ cause: deleted.eventId }]);
    });

    it('rejects a snapshot with a broken rate card', async () => {
      const broken = createEnvelope(
        ItemCreatedV1,
        item({ pricing: { free: true, dailyCents: 500 } }),
      );
      await expect(bookings.receive(broken)).rejects.toThrow(InvalidEventError);
      const rows = await bookings.dataSource.query(
        `SELECT 1 FROM items WHERE item_id = $1`,
        [broken.payload.itemId],
      );
      expect(rows).toEqual([]);
    });
  });

  describe('users', () => {
    it('keeps the newest name and the verification, in any order', async () => {
      const userId = randomUUID();
      await deliver(createEnvelope(UserEmailVerifiedV1, { userId }, minute(0)));
      await deliver(
        createEnvelope(
          UserProfileUpdatedV1,
          { userId, displayName: 'Newer', locale: 'en' },
          minute(5),
        ),
      );
      await deliver(
        createEnvelope(
          UserRegisteredV1,
          {
            userId,
            email: 'private@example.com',
            displayName: 'Older',
            locale: 'el',
          },
          minute(1),
        ),
      );
      const user = await storedUser(userId);
      expect(user.display_name).toBe('Newer');
      expect(user.email_verified_at).toEqual(minute(0).occurredAt);
    });

    it('keeps the newest profile photo, and forgets it on deletion', async () => {
      const userId = randomUUID();
      const photo = (key: string) => ({
        small: `https://media.test/profiles/${key}/96.webp`,
        large: `https://media.test/profiles/${key}/512.webp`,
      });
      const updated = (m: number, value: unknown, displayName = 'Maria') =>
        createEnvelope(
          UserProfileUpdatedV1,
          { userId, displayName, locale: 'el', photo: value } as never,
          minute(m),
        );

      await deliver(updated(10, photo('a')));
      expect((await storedUser(userId)).photo).toEqual(photo('a'));
      // Older, arriving late: ignored.
      await deliver(updated(5, photo('old')));
      expect((await storedUser(userId)).photo).toEqual(photo('a'));
      // An event without the field (older Identity) keeps the photo.
      await deliver(
        createEnvelope(
          UserProfileUpdatedV1,
          { userId, displayName: 'Maria P.', locale: 'el' },
          minute(20),
        ),
      );
      expect(await storedUser(userId)).toMatchObject({
        display_name: 'Maria P.',
        photo: photo('a'),
      });
      // Removed.
      await deliver(updated(30, null));
      expect((await storedUser(userId)).photo).toBeNull();

      await deliver(updated(40, photo('b')));
      await deliver(
        createEnvelope(UserDeletionRequestedV1, { userId }, minute(50)),
      );
      expect((await storedUser(userId)).photo).toBeNull();
    });

    it('forgets a deleted user for good', async () => {
      const userId = randomUUID();
      await deliver(createEnvelope(UserEmailVerifiedV1, { userId }, minute(0)));
      await deliver(
        createEnvelope(UserDeletionRequestedV1, { userId }, minute(1)),
      );
      await deliver(
        createEnvelope(
          UserProfileUpdatedV1,
          { userId, displayName: 'Back?', locale: 'en' },
          minute(9),
        ),
      );
      await deliver(createEnvelope(UserEmailVerifiedV1, { userId }, minute(9)));
      expect(await storedUser(userId)).toMatchObject({
        display_name: null,
        email_verified_at: null,
      });
      expect((await storedUser(userId)).deleted_at).not.toBeNull();
    });
  });
});
