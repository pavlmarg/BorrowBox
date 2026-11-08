import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { BookingsRpcPattern } from '@borrowbox/contracts';
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
} from '../testing/bookings-harness';
import { MIGRATIONS } from './database/database.module';

/**
 * Boots the real AppModule against Postgres (bookings_svc role), RabbitMQ
 * and Redis, and checks the schema's own guards: the database refuses a
 * double booking and a malformed period whatever the code does.
 */
describe('Bookings AppModule (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let redis: TestRedis;
  let bookings: BookingsHarness;
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
  });

  afterAll(async () => {
    await bookings?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop(), redis?.stop()]);
  });

  it('migrates into the bookings schema only', async () => {
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
          'bookings',
          'conversations',
          'items',
          'message_reports',
          'messages',
          'migrations',
          'offers',
          'outbox',
          'processed_events',
          'users',
        ].map((table_name) => ({ table_schema: 'bookings', table_name })),
      );
    } finally {
      await admin.end();
    }
    // Idempotent: nothing left to run.
    expect(await bookings.dataSource.showMigrations()).toBe(false);
    expect(MIGRATIONS).toHaveLength(4);
  });

  describe('database guards', () => {
    const itemId = randomUUID();
    const lenderId = randomUUID();

    async function insert(
      status: string,
      period: string,
      item = itemId,
    ): Promise<string> {
      const id = randomUUID();
      await bookings.dataSource.query(
        `INSERT INTO bookings (id, item_id, lender_id, renter_id, item_title,
                               pricing, units, rent_cents, deposit_cents,
                               fee_cents, lender_fee_cents, period, status)
         VALUES ($1, $2, $3, $4, 'Drill', '{"free": true}', '{}', 0, 0, 0, 0,
                 $5::tstzrange, $6)`,
        [id, item, lenderId, randomUUID(), period, status],
      );
      return id;
    }

    it('refuses two bookings holding overlapping periods of one item', async () => {
      await insert('ACCEPTED', '[2027-01-01 10:00Z, 2027-01-01 14:00Z)');
      for (const status of ['ACCEPTED', 'CONFIRMED', 'PAID', 'PICKED_UP']) {
        await expect(
          insert(status, '[2027-01-01 13:00Z, 2027-01-01 15:00Z)'),
        ).rejects.toMatchObject({ code: '23P01' });
      }
    });

    it('allows overlaps that hold nothing, touching periods and other items', async () => {
      await insert('ACCEPTED', '[2027-02-01 10:00Z, 2027-02-01 14:00Z)');
      for (const status of ['REQUESTED', 'DECLINED', 'CANCELLED', 'EXPIRED']) {
        await insert(status, '[2027-02-01 12:00Z, 2027-02-01 13:00Z)');
      }
      // [10, 14) and [14, 16) don't overlap.
      await insert('CONFIRMED', '[2027-02-01 14:00Z, 2027-02-01 16:00Z)');
      await insert(
        'ACCEPTED',
        '[2027-02-01 10:00Z, 2027-02-01 14:00Z)',
        randomUUID(),
      );
    });

    it.each([
      ['not on the hour', '[2027-03-01 10:30Z, 2027-03-01 12:00Z)'],
      ['empty', '[2027-03-01 10:00Z, 2027-03-01 10:00Z)'],
      ['closed at the end', '[2027-03-01 10:00Z, 2027-03-01 12:00Z]'],
      ['unbounded', '[2027-03-01 10:00Z,)'],
      ['longer than 90 days', '[2027-03-01 00:00Z, 2027-06-01 00:00Z)'],
    ])('refuses a period %s', async (_, period) => {
      await expect(insert('REQUESTED', period)).rejects.toMatchObject({
        code: '23514',
      });
    });
  });

  it('answers a pattern it has no handler for with an error', async () => {
    await expect(
      bookings.send('bookings.no.such.pattern' as BookingsRpcPattern, {}),
    ).rejects.toMatch(/no matching message handler/i);
  });
});
