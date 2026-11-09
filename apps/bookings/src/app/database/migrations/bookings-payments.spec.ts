import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { createServiceDataSource } from '@borrowbox/service-kit';
import { startPostgres, type TestPostgres } from '@borrowbox/testing';
import { MIGRATIONS } from '../database.module';
import { BookingsPayments1762600000000 } from './1762600000000-bookings-payments';

/** Checkout's migration on a database that already has bookings. */
describe('BookingsPayments migration (integration)', () => {
  let pg: TestPostgres;
  let db: DataSource;

  beforeAll(async () => {
    pg = await startPostgres();
    const earlier = MIGRATIONS.filter(
      (m) => m !== BookingsPayments1762600000000,
    );
    db = createServiceDataSource(pg.urlFor('bookings'), earlier);
    await db.initialize();
    await db.runMigrations();
  });

  afterAll(async () => {
    await db?.destroy();
    await pg?.stop();
  });

  async function insert(
    status: string,
    rent: number,
    deposit: number,
    startInHours: number,
  ) {
    const id = randomUUID();
    const start = new Date(
      Math.ceil(Date.now() / 3_600_000) * 3_600_000 + startInHours * 3_600_000,
    );
    const end = new Date(start.getTime() + 2 * 3_600_000);
    await db.query(
      `INSERT INTO bookings (id, item_id, lender_id, renter_id, item_title,
                             pricing, units, rent_cents, deposit_cents,
                             period, status)
       VALUES ($1, $2, $3, $4, 'Drill', '{"free": false, "hourlyCents": 100}',
               '{}', $5, $6, tstzrange($7, $8, '[)'), $9)`,
      [
        id,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        rent,
        deposit,
        start,
        end,
        status,
      ],
    );
    return { id, start };
  }

  it('gives existing bookings their fees and accepted ones a pay-by time', async () => {
    const requested = await insert('REQUESTED', 2000, 5000, 48);
    const soon = await insert('ACCEPTED', 300, 0, 5);
    const later = await insert('ACCEPTED', 0, 3000, 48);

    const runner = db.createQueryRunner();
    try {
      await new BookingsPayments1762600000000().up(runner);
    } finally {
      await runner.release();
    }

    const rows: Array<{
      id: string;
      fee_cents: number;
      lender_fee_cents: number;
      pay_by: Date | null;
    }> = await db.query(
      `SELECT id, fee_cents, lender_fee_cents, pay_by FROM bookings`,
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    // ADR-0020's examples.
    expect(byId[requested.id]).toMatchObject({
      fee_cents: 200,
      lender_fee_cents: 150,
      pay_by: null,
    });
    expect(byId[soon.id]).toMatchObject({ fee_cents: 62, lender_fee_cents: 0 });
    expect(byId[later.id]).toMatchObject({
      fee_cents: 146,
      lender_fee_cents: 0,
    });
    // 24 hours from now, or the start if sooner.
    expect(byId[soon.id].pay_by?.getTime()).toBe(soon.start.getTime());
    const in24h = Date.now() + 24 * 3_600_000;
    expect(
      Math.abs((byId[later.id].pay_by?.getTime() ?? 0) - in24h),
    ).toBeLessThan(60_000);

    // The new reason and chat line are allowed now.
    await db.query(
      `UPDATE bookings SET status = 'EXPIRED', reason = 'PAYMENT_TIMEOUT' WHERE id = $1`,
      [later.id],
    );
    const [{ code }] = await db.query(
      `SELECT pg_get_constraintdef(oid) AS code FROM pg_constraint
        WHERE conname = 'messages_system_code_check'`,
    );
    expect(code).toContain('BOOKING_PAID');
  });
});
