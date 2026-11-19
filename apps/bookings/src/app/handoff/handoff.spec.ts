import { randomUUID } from 'node:crypto';
import {
  BookingsRpc,
  HANDOFF_CODE_ATTEMPTS,
  type BookingView,
  type BookingsDataExport,
  type HandoffTokenResponse,
  type ItemSnapshotV1,
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
import { HandoffStore } from './handoff-store';

const HOUR = 60 * 60 * 1000;
/** A whole hour `hours` from now (rounded up). */
const at = (hours: number) =>
  new Date(Math.ceil(Date.now() / HOUR) * HOUR + hours * HOUR);
const plus = (date: Date | string, hours: number) =>
  new Date(new Date(date).getTime() + hours * HOUR);

/**
 * The QR handoff and its timeline (ARCHITECTURE.md §5, ADR-0026) through
 * real RPC, with Postgres (state, outbox), Redis (nonces, codes, jobs).
 */
describe('Handoff (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let redis: TestRedis;
  let bookings: BookingsHarness;
  let expiry: BookingExpiry;
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
  });

  afterAll(async () => {
    await bookings?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop(), redis?.stop()]);
  });

  const as = async (userId: string) => ({
    accessToken: await bookings.tokenFor(userId),
  });
  const failure = (code: string) =>
    expect.objectContaining<Partial<RpcErrorBody>>({ code });

  /**
   * A booking going ahead: paid (a deposit unless told otherwise), or
   * CONFIRMED when free. Starts in `startIn` hours (1: the pickup is open), lasts 3.
   */
  async function goingAhead(
    options: { startIn?: number; item?: Partial<ItemSnapshotV1> } = {},
  ) {
    const lender = await bookings.addUser({ name: 'Lena' });
    const renter = await bookings.addUser({ name: 'Rafael' });
    const item = await bookings.addItem(lender, options.item);
    const start = at(options.startIn ?? 1);
    const requested: BookingView = await bookings.send(
      BookingsRpc.request,
      {
        bookingId: randomUUID(),
        itemId: item.itemId,
        start: start.toISOString(),
        end: plus(start, 3).toISOString(),
      },
      await as(renter),
    );
    const accepted: BookingView = await bookings.send(
      BookingsRpc.accept,
      { bookingId: requested.id },
      await as(lender),
    );
    if (accepted.status === 'ACCEPTED') {
      await bookings.pay(accepted.id, accepted.price.totalCents);
    }
    return { lender, renter, id: requested.id, start };
  }

  async function token(
    userId: string,
    bookingId: string,
    phase: 'PICKUP' | 'RETURN',
  ): Promise<HandoffTokenResponse> {
    return bookings.send(
      BookingsRpc.handoffToken,
      { bookingId, phase },
      await as(userId),
    );
  }

  async function scan(
    userId: string,
    bookingId: string,
    data: { token?: string; phase?: 'PICKUP' | 'RETURN'; code?: string },
  ): Promise<BookingView> {
    return bookings.send(
      BookingsRpc.handoffScan,
      { bookingId, ...data },
      await as(userId),
    );
  }

  async function answer(
    userId: string,
    bookingId: string,
    phase: 'PICKUP' | 'RETURN',
    reply: 'YES' | 'NO',
  ): Promise<BookingView> {
    return bookings.send(
      BookingsRpc.handoffAnswer,
      { bookingId, phase, answer: reply },
      await as(userId),
    );
  }

  const get = async (userId: string, bookingId: string): Promise<BookingView> =>
    bookings.send(BookingsRpc.get, { bookingId }, await as(userId));

  /** The booking's events in the outbox after `booking.paid`/`.confirmed`. */
  async function events(bookingId: string): Promise<string[]> {
    const rows: Array<{ routing_key: string; extra: string | null }> =
      await bookings.dataSource.query(
        `SELECT routing_key,
                COALESCE(envelope->'payload'->>'reason',
                         envelope->'payload'->>'round') AS extra
           FROM outbox WHERE envelope->'payload'->>'bookingId' = $1
          ORDER BY id`,
        [bookingId],
      );
    const all = rows.map((r) =>
      r.extra ? `${r.routing_key}:${r.extra}` : r.routing_key,
    );
    const from = all.findIndex(
      (e) => e === 'booking.paid.v1' || e === 'booking.confirmed.v1',
    );
    return all.slice(from + 1);
  }

  async function payload(bookingId: string, routingKey: string) {
    const [row] = await bookings.dataSource.query(
      `SELECT envelope->'payload' AS payload FROM outbox
        WHERE envelope->'payload'->>'bookingId' = $1 AND routing_key = $2`,
      [bookingId, routingKey],
    );
    return row?.payload;
  }

  async function handoffRow(bookingId: string, phase: string) {
    const [row] = await bookings.dataSource.query(
      `SELECT method, shown_by, scanned_by FROM handoffs
        WHERE booking_id = $1 AND phase = $2`,
      [bookingId, phase],
    );
    return row ?? null;
  }

  describe('QR scans', () => {
    it('picks up, returns and completes after the claim window', async () => {
      const { lender, renter, id } = await goingAhead();

      const shown = await token(lender, id, 'PICKUP');
      expect(shown.refreshAfterSeconds).toBe(30);
      const picked = await scan(renter, id, { token: shown.token });
      expect(picked.status).toBe('PICKED_UP');
      expect(picked.handoff.pickedUpAt).not.toBeNull();
      expect(await handoffRow(id, 'PICKUP')).toEqual({
        method: 'QR',
        shown_by: lender,
        scanned_by: renter,
      });

      const back = await scan(lender, id, {
        token: (await token(renter, id, 'RETURN')).token,
      });
      expect(back.status).toBe('RETURNED');
      expect(back.handoff.claimUntil).toBe(
        plus(back.handoff.returnedAt as string, 48).toISOString(),
      );
      expect((await payload(id, 'booking.returned.v1')).claimUntil).toBe(
        back.handoff.claimUntil,
      );

      // Not before the window closes, then completed.
      expect(
        await expiry.expire(id, plus(back.handoff.claimUntil as string, -1)),
      ).toBe(false);
      expect(
        await expiry.expire(id, plus(back.handoff.claimUntil as string, 0)),
      ).toBe(true);
      expect((await get(renter, id)).status).toBe('COMPLETED');
      expect(await events(id)).toEqual([
        'booking.picked_up.v1',
        'booking.returned.v1',
        'booking.completed.v1',
      ]);
    });

    it('completes at the return when there is no deposit', async () => {
      const { lender, renter, id } = await goingAhead({
        item: { depositCents: 0 },
      });
      await scan(renter, id, {
        token: (await token(lender, id, 'PICKUP')).token,
      });
      const done = await scan(lender, id, {
        token: (await token(renter, id, 'RETURN')).token,
      });
      expect(done.status).toBe('COMPLETED');
      expect((await payload(id, 'booking.returned.v1')).claimUntil).toBeNull();
      expect(await events(id)).toEqual([
        'booking.picked_up.v1',
        'booking.returned.v1',
        'booking.completed.v1',
      ]);
    });

    it('works for free bookings (CONFIRMED)', async () => {
      const { lender, renter, id } = await goingAhead({
        item: { pricing: { free: true }, depositCents: 0 },
      });
      expect((await get(renter, id)).status).toBe('CONFIRMED');
      const picked = await scan(renter, id, {
        token: (await token(lender, id, 'PICKUP')).token,
      });
      expect(picked.status).toBe('PICKED_UP');
    });

    it('accepts the typed code, and stops after too many wrong ones', async () => {
      const { lender, renter, id } = await goingAhead();
      const shown = await token(lender, id, 'PICKUP');

      for (let i = 1; i < HANDOFF_CODE_ATTEMPTS; i++) {
        await expect(
          scan(renter, id, {
            phase: 'PICKUP',
            code: '000000' === shown.code ? '000001' : '000000',
          }),
        ).rejects.toEqual(failure('TOKEN_INVALID'));
      }
      await expect(
        scan(renter, id, {
          phase: 'PICKUP',
          code: shown.code === '999999' ? '999998' : '999999',
        }),
      ).rejects.toEqual(failure('RATE_LIMITED'));
      // Even the right code waits out the window now.
      await expect(
        scan(renter, id, { phase: 'PICKUP', code: shown.code }),
      ).rejects.toEqual(failure('RATE_LIMITED'));

      const other = await goingAhead();
      const code = (await token(other.lender, other.id, 'PICKUP')).code;
      const picked = await scan(other.renter, other.id, {
        phase: 'PICKUP',
        code,
      });
      expect(picked.status).toBe('PICKED_UP');
      expect((await handoffRow(other.id, 'PICKUP')).method).toBe('CODE');
    });

    it('refuses the wrong scanner, outsiders, other bookings and early pickups', async () => {
      const { lender, renter, id } = await goingAhead();
      const shown = await token(lender, id, 'PICKUP');

      await expect(scan(lender, id, { token: shown.token })).rejects.toEqual(
        failure('NOT_COUNTERPARTY'),
      );
      const stranger = await bookings.addUser();
      await expect(scan(stranger, id, { token: shown.token })).rejects.toEqual(
        failure('NOT_FOUND'),
      );
      await expect(token(stranger, id, 'PICKUP')).rejects.toEqual(
        failure('NOT_FOUND'),
      );
      // The renter shows the return code, not the pickup one.
      await expect(token(renter, id, 'PICKUP')).rejects.toEqual(
        failure('INVALID_STATE'),
      );
      await expect(token(renter, id, 'RETURN')).rejects.toEqual(
        failure('INVALID_STATE'),
      );

      const other = await goingAhead();
      await expect(
        scan(other.renter, other.id, { token: shown.token }),
      ).rejects.toEqual(failure('TOKEN_INVALID'));
      await expect(
        scan(renter, id, { token: shown.token.slice(0, -2) + 'AA' }),
      ).rejects.toEqual(failure('TOKEN_INVALID'));
      await expect(
        scan(renter, id, { token: shown.token, code: shown.code }),
      ).rejects.toEqual(failure('VALIDATION_FAILED'));

      const later = await goingAhead({ startIn: 30 });
      await expect(token(later.lender, later.id, 'PICKUP')).rejects.toEqual(
        failure('INVALID_STATE'),
      );
      expect((await get(renter, id)).status).toBe('PAID');
    });

    it('repeats a scan without a second event; a nonce is spent once', async () => {
      const { lender, renter, id } = await goingAhead();
      const shown = await token(lender, id, 'PICKUP');
      await scan(renter, id, { token: shown.token });
      const again = await scan(renter, id, { token: shown.token });
      expect(again.status).toBe('PICKED_UP');
      expect(await events(id)).toEqual(['booking.picked_up.v1']);

      const store = bookings.app.get(HandoffStore);
      const nonce = randomUUID().replace(/-/g, '').slice(0, 22);
      expect(await store.spendNonce(nonce)).toBe(true);
      expect(await store.spendNonce(nonce)).toBe(false);
    });

    it('tells the gateway who has an item out', async () => {
      const { lender, renter, id } = await goingAhead();
      const active = async (userId: string) =>
        (await bookings.send(BookingsRpc.activeRentals, {}, await as(userId)))
          .active;
      expect(await active(renter)).toBe(false);
      await scan(renter, id, {
        token: (await token(lender, id, 'PICKUP')).token,
      });
      expect(await active(renter)).toBe(true);
      expect(await active(lender)).toBe(true);
      await scan(lender, id, {
        token: (await token(renter, id, 'RETURN')).token,
      });
      // RETURNED: the claim window still runs.
      expect(await active(lender)).toBe(true);
    });
  });

  describe('when nobody scans the pickup', () => {
    it('asks three times, then expires it (NO_HANDOFF)', async () => {
      const { renter, id, start } = await goingAhead();
      // Nothing to answer before the first round.
      await expect(answer(renter, id, 'PICKUP', 'YES')).rejects.toEqual(
        failure('INVALID_STATE'),
      );
      for (const h of [2, 24, 48]) {
        expect(await expiry.expire(id, plus(start, h))).toBe(true);
      }
      const asked = await get(renter, id);
      expect(asked.handoff.question).toEqual({
        phase: 'PICKUP',
        myAnswer: null,
        otherAnswered: false,
        decideAt: plus(start, 72).toISOString(),
      });
      expect(
        await (
          await payload(id, 'booking.handoff_unconfirmed.v1')
        ).askUserIds,
      ).toHaveLength(2);

      expect(await expiry.expire(id, plus(start, 71))).toBe(false);
      expect(await expiry.expire(id, plus(start, 72))).toBe(true);
      expect((await get(renter, id)).reason).toBe('NO_HANDOFF');
      expect(await events(id)).toEqual([
        'booking.handoff_unconfirmed.v1:1',
        'booking.handoff_unconfirmed.v1:2',
        'booking.handoff_unconfirmed.v1:3',
        'booking.expired.v1:NO_HANDOFF',
      ]);
    });

    it('sends only the latest round when the timer comes late', async () => {
      const { renter, id, start } = await goingAhead();
      await expiry.expire(id, plus(start, 30));
      expect(await events(id)).toEqual(['booking.handoff_unconfirmed.v1:2']);
      expect((await get(renter, id)).handoff.question?.phase).toBe('PICKUP');
    });

    it('both yes: picked up, as if scanned', async () => {
      const { lender, renter, id, start } = await goingAhead();
      await expiry.expire(id, plus(start, 2));
      const half = await answer(lender, id, 'PICKUP', 'YES');
      expect(half.status).toBe('PAID');
      expect(half.handoff.question).toMatchObject({
        myAnswer: 'YES',
        otherAnswered: false,
      });
      expect((await get(renter, id)).handoff.question).toMatchObject({
        myAnswer: null,
        otherAnswered: true,
      });
      // Round 2 asks only the renter.
      await expiry.expire(id, plus(start, 24));
      const [, round2] = await bookings.dataSource.query(
        `SELECT envelope->'payload'->'askUserIds' AS ask FROM outbox
          WHERE envelope->'payload'->>'bookingId' = $1
            AND routing_key = 'booking.handoff_unconfirmed.v1' ORDER BY id`,
        [id],
      );
      expect(round2.ask).toEqual([renter]);

      const both = await answer(renter, id, 'PICKUP', 'YES');
      expect(both.status).toBe('PICKED_UP');
      expect((await handoffRow(id, 'PICKUP')).method).toBe('CONFIRMED');
      // Repeating the same answer is fine; changing it isn't.
      expect((await answer(renter, id, 'PICKUP', 'YES')).status).toBe(
        'PICKED_UP',
      );
    });

    it('both no: expired at once', async () => {
      const { lender, renter, id, start } = await goingAhead();
      await expiry.expire(id, plus(start, 2));
      await answer(lender, id, 'PICKUP', 'NO');
      await expect(answer(lender, id, 'PICKUP', 'YES')).rejects.toEqual(
        failure('INVALID_STATE'),
      );
      const done = await answer(renter, id, 'PICKUP', 'NO');
      expect(done).toMatchObject({ status: 'EXPIRED', reason: 'NO_HANDOFF' });
    });

    it('yes and no: an admin decides; the money stays put', async () => {
      const { lender, renter, id, start } = await goingAhead();
      await expiry.expire(id, plus(start, 2));
      await answer(lender, id, 'PICKUP', 'YES');
      const review = await answer(renter, id, 'PICKUP', 'NO');
      expect(review.status).toBe('PAID');
      expect(review.handoff).toMatchObject({
        review: 'PICKUP_UNCONFIRMED',
        question: null,
      });
      expect(await events(id)).toEqual([
        'booking.handoff_unconfirmed.v1:1',
        'booking.review_requested.v1:PICKUP_UNCONFIRMED',
      ]);
      // The timeline stops until an admin acts.
      expect(await expiry.expire(id, plus(start, 200))).toBe(false);
    });

    it('one yes, the other silent: an admin decides at the deadline', async () => {
      const { renter, id, start } = await goingAhead();
      await expiry.expire(id, plus(start, 2));
      await answer(renter, id, 'PICKUP', 'YES');
      await expiry.expire(id, plus(start, 72));
      expect((await get(renter, id)).handoff.review).toBe('PICKUP_UNCONFIRMED');
    });

    it('a return scanned during the review proves the pickup', async () => {
      const { lender, renter, id, start } = await goingAhead();
      await expiry.expire(id, plus(start, 2));
      await answer(lender, id, 'PICKUP', 'YES');
      await answer(renter, id, 'PICKUP', 'NO');

      const back = await scan(lender, id, {
        token: (await token(renter, id, 'RETURN')).token,
      });
      expect(back.status).toBe('RETURNED');
      expect(back.handoff.review).toBeNull();
      expect((await handoffRow(id, 'PICKUP')).method).toBe('RETURN_SCAN');
    });
  });

  describe('when nobody scans the return', () => {
    async function pickedUp() {
      const booking = await goingAhead();
      await scan(booking.renter, booking.id, {
        token: (await token(booking.lender, booking.id, 'PICKUP')).token,
      });
      const end = plus(booking.start, 3);
      await expiry.expire(booking.id, plus(end, 2));
      return { ...booking, end };
    }

    it("the lender's yes is enough", async () => {
      const { lender, id } = await pickedUp();
      const back = await answer(lender, id, 'RETURN', 'YES');
      expect(back.status).toBe('RETURNED');
      expect((await handoffRow(id, 'RETURN')).method).toBe('CONFIRMED');
    });

    it("the lender's no goes to an admin", async () => {
      const { lender, id } = await pickedUp();
      const review = await answer(lender, id, 'RETURN', 'NO');
      expect(review).toMatchObject({
        status: 'PICKED_UP',
        handoff: { review: 'RETURN_UNCONFIRMED' },
      });
    });

    it('without the lender by the deadline, an admin decides', async () => {
      const { renter, id, end } = await pickedUp();
      await answer(renter, id, 'RETURN', 'YES');
      expect((await get(renter, id)).status).toBe('PICKED_UP');
      await expiry.expire(id, plus(end, 72));
      expect((await get(renter, id)).handoff.review).toBe('RETURN_UNCONFIRMED');
    });
  });

  it('the sweeper catches due handoffs a lost job missed', async () => {
    const { renter, id, start } = await goingAhead();
    await expiry.sweep(plus(start, 3));
    expect((await get(renter, id)).handoff.question?.phase).toBe('PICKUP');
  });

  it('exports handoffs and answers', async () => {
    const { lender, renter, id, start } = await goingAhead();
    await expiry.expire(id, plus(start, 2));
    await answer(lender, id, 'PICKUP', 'YES');
    await answer(renter, id, 'PICKUP', 'YES');
    const data: BookingsDataExport = await bookings.send(
      BookingsRpc.exportMe,
      {},
      await as(renter),
    );
    expect(data.handoffs).toEqual([
      expect.objectContaining({
        bookingId: id,
        phase: 'PICKUP',
        method: 'CONFIRMED',
        answer: 'YES',
      }),
    ]);
  });
});
