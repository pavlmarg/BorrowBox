import { randomUUID } from 'node:crypto';
import { BookingsRpc, type BookingView } from '@borrowbox/contracts';
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
import { BookingExpiry } from './booking-expiry';
import { ExpiryQueue } from './expiry-queue';

const HOUR = 60 * 60 * 1000;
const at = (hours: number) =>
  new Date(Math.ceil(Date.now() / HOUR) * HOUR + hours * HOUR).toISOString();

/**
 * Expiry (ADR-0015): delayed jobs in a real Redis, and the sweeper, both
 * re-checking the booking in Postgres before acting.
 */
describe('Booking expiry (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let redis: TestRedis;
  let bookings: BookingsHarness;
  let expiry: BookingExpiry;
  let queue: ExpiryQueue;
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
    expiry = bookings.app.get(BookingExpiry);
    queue = bookings.app.get(ExpiryQueue);
  });

  afterAll(async () => {
    await bookings?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop(), redis?.stop()]);
  });

  async function setup(free = false) {
    const lender = await bookings.addUser();
    const renter = await bookings.addUser();
    const item = await bookings.addItem(
      lender,
      free ? { pricing: { free: true }, depositCents: 0 } : {},
    );
    const booking: BookingView = await bookings.send(
      BookingsRpc.request,
      {
        bookingId: randomUUID(),
        itemId: item.itemId,
        start: at(30),
        end: at(32),
      },
      { accessToken: await bookings.tokenFor(renter) },
    );
    return { lender, renter, item, booking };
  }

  async function status(id: string) {
    const [row] = await bookings.dataSource.query(
      `SELECT status, reason FROM bookings WHERE id = $1`,
      [id],
    );
    return row;
  }

  const accept = async (lender: string, id: string) =>
    bookings.send(
      BookingsRpc.accept,
      { bookingId: id },
      { accessToken: await bookings.tokenFor(lender) },
    );

  it('schedules a check at the request deadline', async () => {
    const { booking } = await setup();
    const deadline = new Date(booking.expiresAt as string).getTime();
    const job = await queue.queue.getJob(`expire-${booking.id}-${deadline}`);
    expect(job?.data).toEqual({ bookingId: booking.id });
    expect(await job?.isDelayed()).toBe(true);
  });

  it('expires an unanswered request after its deadline, and only then', async () => {
    const { booking } = await setup();
    const deadline = new Date(booking.expiresAt as string);
    expect(
      await expiry.expire(booking.id, new Date(deadline.getTime() - 1)),
    ).toBe(false);
    expect(await expiry.expire(booking.id, deadline)).toBe(true);
    expect(await status(booking.id)).toEqual({
      status: 'EXPIRED',
      reason: 'NO_ANSWER',
    });
    // A late or repeated job does nothing.
    expect(await expiry.expire(booking.id, deadline)).toBe(false);
  });

  it('expires a request whose start came first as STARTED', async () => {
    const { booking } = await setup();
    expect(await expiry.expire(booking.id, new Date(booking.start))).toBe(true);
    expect((await status(booking.id)).reason).toBe('STARTED');
  });

  it('leaves an answered request alone', async () => {
    const { lender, booking } = await setup(true);
    await accept(lender, booking.id);
    expect(
      await expiry.expire(booking.id, new Date(booking.expiresAt as string)),
    ).toBe(false);
    expect((await status(booking.id)).status).toBe('CONFIRMED');
  });

  it('expires an accepted booking still unpaid at its start (Q8)', async () => {
    const { lender, booking } = await setup();
    await accept(lender, booking.id);
    const start = new Date(booking.start);
    expect(
      await queue.queue.getJob(`expire-${booking.id}-${start.getTime()}`),
    ).toBeDefined();
    expect(await expiry.expire(booking.id, new Date(start.getTime() - 1))).toBe(
      false,
    );
    expect(await expiry.expire(booking.id, start)).toBe(true);
    expect(await status(booking.id)).toEqual({
      status: 'EXPIRED',
      reason: 'STARTED',
    });
  });

  it('runs a due job through the worker', async () => {
    const { booking } = await setup();
    await bookings.dataSource.query(
      `UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [booking.id],
    );
    await queue.checkAt(booking.id, new Date());
    const deadline = Date.now() + 15_000;
    while ((await status(booking.id)).status !== 'EXPIRED') {
      if (Date.now() > deadline) throw new Error('the job did not run');
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  it('sweeps up what lost jobs left behind', async () => {
    const { booking: due } = await setup();
    const { booking: notDue } = await setup();
    await bookings.dataSource.query(
      `UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [due.id],
    );
    expect(await expiry.sweep()).toBeGreaterThanOrEqual(1);
    expect((await status(due.id)).status).toBe('EXPIRED');
    expect((await status(notDue.id)).status).toBe('REQUESTED');

    const rows = await bookings.dataSource.query(
      `SELECT envelope->'payload'->>'reason' AS reason FROM outbox
        WHERE routing_key = 'booking.expired.v1'
          AND envelope->'payload'->>'bookingId' = $1`,
      [due.id],
    );
    expect(rows).toEqual([{ reason: 'NO_ANSWER' }]);
  });
});
