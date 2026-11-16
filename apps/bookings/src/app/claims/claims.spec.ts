import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import {
  BookingsRpc,
  type BookingView,
  type BookingsDataExport,
  type ClaimView,
  type RpcErrorBody,
} from '@borrowbox/contracts';
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
import { BookingExpiry } from '../expiry/booking-expiry';
import { resolveDispute } from './resolve-dispute.task';

const HOUR = 60 * 60 * 1000;
const at = (hours: number) =>
  new Date(Math.ceil(Date.now() / HOUR) * HOUR + hours * HOUR);

/**
 * Damage claims (ADR-0028) through real RPC, with Postgres (state, outbox)
 * and Redis (handoff nonces, timers): filing, agreeing, disagreeing,
 * withdrawing, the dev command, and what each writes for Payments.
 */
describe('Damage claims (integration)', () => {
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

  const as = async (userId: string) => ({
    accessToken: await bookings.tokenFor(userId),
  });

  async function failure(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (err) {
      return (err as RpcErrorBody).code;
    }
    throw new Error('expected the call to fail');
  }

  /** A paid booking (€50 deposit) picked up and returned: the claim window is open. */
  async function returned() {
    const lender = await bookings.addUser({ name: 'Lena' });
    const renter = await bookings.addUser({ name: 'Rafael' });
    const item = await bookings.addItem(lender, { depositCents: 5000 });
    const start = at(1);
    const requested: BookingView = await bookings.send(
      BookingsRpc.request,
      {
        bookingId: randomUUID(),
        itemId: item.itemId,
        start: start.toISOString(),
        end: new Date(start.getTime() + 3 * HOUR).toISOString(),
      },
      await as(renter),
    );
    const accepted: BookingView = await bookings.send(
      BookingsRpc.accept,
      { bookingId: requested.id },
      await as(lender),
    );
    await bookings.pay(accepted.id, accepted.price.totalCents);
    const id = requested.id;
    for (const [shower, scanner, phase] of [
      [lender, renter, 'PICKUP'],
      [renter, lender, 'RETURN'],
    ] as const) {
      const { token } = await bookings.send(
        BookingsRpc.handoffToken,
        { bookingId: id, phase },
        await as(shower),
      );
      await bookings.send(
        BookingsRpc.handoffScan,
        { bookingId: id, token },
        await as(scanner),
      );
    }
    return { lender, renter, id };
  }

  const file = async (
    userId: string,
    bookingId: string,
    amountCents = 3000,
    description = 'The drill chuck is cracked and no longer holds a bit.',
    photoIds?: string[],
  ): Promise<ClaimView> =>
    bookings.send(
      BookingsRpc.claimFile,
      { bookingId, amountCents, description, photoIds },
      await as(userId),
    );

  const answer = async (
    userId: string,
    bookingId: string,
    reply: 'AGREE' | 'DISAGREE',
    text?: string,
  ): Promise<ClaimView> =>
    bookings.send(
      BookingsRpc.claimAnswer,
      { bookingId, answer: reply, reply: text },
      await as(userId),
    );

  const status = async (userId: string, bookingId: string) =>
    (
      (await bookings.send(
        BookingsRpc.get,
        { bookingId },
        await as(userId),
      )) as BookingView
    ).status;

  /** The booking's events after the return: [routingKey, payload]. */
  async function eventsAfterReturn(bookingId: string) {
    const rows: Array<{
      routing_key: string;
      payload: Record<string, unknown>;
    }> = await bookings.dataSource.query(
      `SELECT routing_key, envelope->'payload' AS payload FROM outbox
          WHERE envelope->'payload'->>'bookingId' = $1 ORDER BY id`,
      [bookingId],
    );
    const from = rows.findIndex((r) => r.routing_key === 'booking.returned.v1');
    return rows.slice(from + 1);
  }

  it('settles an agreed claim at once: the award rides on booking.completed', async () => {
    const { lender, renter, id } = await returned();
    const filed = await file(lender, id);
    expect(filed).toMatchObject({ status: 'OPEN', amountCents: 3000 });
    expect(await status(renter, id)).toBe('DISPUTED');

    const agreed = await answer(renter, id, 'AGREE', 'Sorry, my mistake.');
    expect(agreed).toMatchObject({
      status: 'AGREED',
      awardCents: 3000,
      reply: 'Sorry, my mistake.',
    });
    expect(await status(lender, id)).toBe('COMPLETED');
    // Repeating the answer changes nothing.
    expect((await answer(renter, id, 'AGREE')).status).toBe('AGREED');

    const events = await eventsAfterReturn(id);
    expect(events.map((e) => e.routing_key)).toEqual([
      'booking.disputed.v1',
      'dispute.resolved.v1',
      'booking.completed.v1',
    ]);
    expect(events[0].payload).toMatchObject({ claimCents: 3000 });
    expect(events[1].payload).toMatchObject({
      claimCents: 3000,
      awardCents: 3000,
      resolvedBy: 'RENTER_AGREED',
    });
    expect(events[2].payload).toMatchObject({ damageAwardCents: 3000 });
  });

  it('waits for an admin when the renter disagrees; the lender may still withdraw', async () => {
    const { lender, renter, id } = await returned();
    await file(lender, id);
    const disagreed = await answer(
      renter,
      id,
      'DISAGREE',
      'It was already cracked.',
    );
    expect(disagreed).toMatchObject({ status: 'DISAGREED', awardCents: null });
    expect(await status(renter, id)).toBe('DISPUTED');
    expect(await failure(answer(renter, id, 'AGREE'))).toBe('INVALID_STATE');

    const withdrawn: ClaimView = await bookings.send(
      BookingsRpc.claimWithdraw,
      { bookingId: id },
      await as(lender),
    );
    expect(withdrawn).toMatchObject({ status: 'WITHDRAWN', awardCents: 0 });
    expect(await status(renter, id)).toBe('COMPLETED');

    const events = await eventsAfterReturn(id);
    expect(events.map((e) => e.routing_key)).toEqual([
      'booking.disputed.v1',
      'dispute.disagreed.v1',
      'dispute.resolved.v1',
      'booking.completed.v1',
    ]);
    expect(events[2].payload).toMatchObject({
      awardCents: 0,
      resolvedBy: 'LENDER_WITHDREW',
    });
    expect(events[3].payload).toMatchObject({ damageAwardCents: 0 });
  });

  it('lets the dev command decide a dispute, within the claimed amount', async () => {
    const { lender, renter, id } = await returned();
    await file(lender, id);
    await answer(renter, id, 'DISAGREE');
    const run = (award: string) =>
      resolveDispute(bookings.dataSource, {} as ConfigService, [
        '--booking',
        id,
        '--award-cents',
        award,
      ]);
    await expect(run('3001')).rejects.toThrow(/0 to the claimed 3000/);
    await expect(run('1500')).resolves.toMatch(/1500 cents/);

    const claim = (
      await bookings.send(
        BookingsRpc.claimGet,
        { bookingId: id },
        await as(renter),
      )
    ).claim as ClaimView;
    expect(claim).toMatchObject({ status: 'DECIDED', awardCents: 1500 });
    expect(await status(lender, id)).toBe('COMPLETED');
    const events = await eventsAfterReturn(id);
    expect(events.at(-1)?.payload).toMatchObject({ damageAwardCents: 1500 });
    await expect(run('0')).rejects.toThrow(/COMPLETED, not DISPUTED/);
  });

  it('refuses claims outside the rules', async () => {
    const { lender, renter, id } = await returned();
    expect(await failure(file(renter, id))).toBe('INVALID_STATE');
    expect(await failure(file(lender, id, 5001))).toBe('VALIDATION_FAILED');
    expect(await failure(file(lender, id, 99))).toBe('VALIDATION_FAILED');
    expect(
      await failure(file(lender, id, 3000, 'Call me on 6912345678 about it')),
    ).toBe('VALIDATION_FAILED');
    expect(await failure(file(lender, id, 3000, 'Too short'))).toBe(
      'VALIDATION_FAILED',
    );
    expect(
      await failure(file(lender, id, 3000, undefined, [randomUUID()])),
    ).toBe('VALIDATION_FAILED');
    const stranger = await bookings.addUser();
    expect(await failure(file(stranger, id))).toBe('NOT_FOUND');

    await file(lender, id, 5000); // the whole deposit is allowed
    expect(await failure(file(lender, id))).toBe('CLAIM_EXISTS');
    expect(await failure(answer(lender, id, 'AGREE'))).toBe('INVALID_STATE');
  });

  it('closes with the claim window, and the window’s timer leaves a dispute alone', async () => {
    const closed = await returned();
    await bookings.dataSource.query(
      `UPDATE bookings SET claim_until = now() - interval '1 minute' WHERE id = $1`,
      [closed.id],
    );
    expect(await failure(file(closed.lender, closed.id))).toBe('INVALID_STATE');

    const { lender, renter, id } = await returned();
    await file(lender, id);
    const expiry = bookings.app.get(BookingExpiry);
    expect(await expiry.expire(id, new Date(Date.now() + 49 * HOUR))).toBe(
      false,
    );
    expect(await status(renter, id)).toBe('DISPUTED');
  });

  it('exports each side’s own text, and blanks it on erasure', async () => {
    const { lender, renter, id } = await returned();
    await file(lender, id);
    await answer(renter, id, 'DISAGREE', 'It was already cracked.');

    const mine: BookingsDataExport = await bookings.send(
      BookingsRpc.exportMe,
      {},
      await as(renter),
    );
    expect(mine.claims).toEqual([
      expect.objectContaining({
        bookingId: id,
        role: 'RENTER',
        amountCents: 3000,
        status: 'DISAGREED',
        myText: 'It was already cracked.',
      }),
    ]);

    await bookings.deleteUser(renter);
    const [row] = await bookings.dataSource.query(
      `SELECT description, reply, amount_cents FROM claims WHERE booking_id = $1`,
      [id],
    );
    expect(row).toEqual({
      description: 'The drill chuck is cracked and no longer holds a bit.',
      reply: null,
      amount_cents: 3000,
    });
  });
});
