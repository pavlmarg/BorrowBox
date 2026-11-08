import { randomUUID } from 'node:crypto';
import {
  BOOKING_OPEN_REQUESTS_MAX,
  BookingsRpc,
  type BookingView,
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

const HOUR = 60 * 60 * 1000;

/** A whole hour at least `hours` from now. */
function at(hours: number): string {
  return new Date(
    Math.ceil(Date.now() / HOUR) * HOUR + hours * HOUR,
  ).toISOString();
}

/**
 * Requests, answers and cancellations through real RPC, with Postgres
 * (exclusion constraint, outbox) and Redis (expiry jobs).
 */
describe('Bookings commands and queries (integration)', () => {
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

  async function request(
    renterId: string,
    item: ItemSnapshotV1,
    start = at(2),
    end = at(5),
    bookingId = randomUUID(),
  ): Promise<BookingView> {
    return bookings.send(
      BookingsRpc.request,
      { bookingId, itemId: item.itemId, start, end },
      await as(renterId),
    );
  }

  async function act(
    pattern: 'accept' | 'decline' | 'cancel' | 'get',
    userId: string,
    bookingId: string,
  ): Promise<BookingView> {
    return bookings.send(BookingsRpc[pattern], { bookingId }, await as(userId));
  }

  /** The booking's events in the outbox, oldest first: [routingKey, reason?]. */
  async function events(bookingId: string): Promise<string[]> {
    const rows: Array<{ routing_key: string; reason: string | null }> =
      await bookings.dataSource.query(
        `SELECT routing_key, envelope->'payload'->>'reason' AS reason
           FROM outbox WHERE envelope->'payload'->>'bookingId' = $1
          ORDER BY id`,
        [bookingId],
      );
    return rows.map((r) =>
      r.reason ? `${r.routing_key}:${r.reason}` : r.routing_key,
    );
  }

  const failure = (code: string) =>
    expect.objectContaining<Partial<RpcErrorBody>>({ code });

  async function people() {
    const lender = await bookings.addUser({ name: 'Lena' });
    const renter = await bookings.addUser({ name: 'Rafael' });
    return { lender, renter };
  }

  describe('quote', () => {
    it('prices the period with the cheapest units, no sign-in needed', async () => {
      const { lender } = await people();
      const item = await bookings.addItem(lender, {
        pricing: { free: false, hourlyCents: 300, dailyCents: 1500 },
        depositCents: 2000,
      });
      // 30 hours: a day + 6 hours (€33) costs more than 2 days (€30).
      const quote = await bookings.send(BookingsRpc.quote, {
        itemId: item.itemId,
        start: at(2),
        end: at(32),
      });
      expect(quote).toMatchObject({
        rentCents: 3000,
        depositCents: 2000,
        totalCents: 5000,
        units: { HOUR: 0, DAY: 2, WEEK: 0, MONTH: 0 },
      });
    });

    it('refuses periods against the rules and unknown or hidden items', async () => {
      const { lender } = await people();
      const item = await bookings.addItem(lender, { minRentalHours: 4 });
      const quote = (itemId: string, start: string, end: string) =>
        bookings.send(BookingsRpc.quote, { itemId, start, end });
      await expect(quote(item.itemId, at(2), at(4))).rejects.toEqual(
        failure('INVALID_PERIOD'),
      );
      // Without an offset the server's own time zone would apply.
      await expect(
        quote(item.itemId, at(2).replace('Z', ''), at(6)),
      ).rejects.toEqual(failure('VALIDATION_FAILED'));
      await expect(
        quote(item.itemId, at(2), at(6).replace('Z', '+00:00')),
      ).resolves.toBeDefined();
      await expect(quote(randomUUID(), at(2), at(6))).rejects.toEqual(
        failure('NOT_FOUND'),
      );
      await bookings.updateItem({ ...item, status: 'PAUSED' });
      await expect(quote(item.itemId, at(2), at(6))).rejects.toEqual(
        failure('NOT_FOUND'),
      );
    });
  });

  describe('request', () => {
    it('creates a REQUESTED booking with a fixed price and writes booking.requested', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const booking = await request(renter, item, at(2), at(5));

      expect(booking).toMatchObject({
        role: 'RENTER',
        status: 'REQUESTED',
        itemTitle: 'Cordless drill',
        renter: { userId: renter, displayName: 'Rafael' },
        lender: { userId: lender, displayName: 'Lena' },
        price: { rentCents: 600, depositCents: 5000, totalCents: 5600 },
        reason: null,
      });
      // Expires in 24 hours, or at the start if sooner: here the start.
      expect(booking.expiresAt).toBe(booking.start);
      expect(await events(booking.id)).toEqual(['booking.requested.v1']);

      // Later price changes don't touch it.
      await bookings.updateItem({
        ...item,
        pricing: { free: false, hourlyCents: 9900 },
      });
      expect(await act('get', renter, booking.id)).toMatchObject({
        price: { rentCents: 600 },
        pricing: item.pricing,
      });
    });

    it('expires in 24 hours when the start is later than that', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const before = Date.now();
      const booking = await request(renter, item, at(48), at(50));
      const expiresAt = new Date(booking.expiresAt as string).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 24 * HOUR);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 24 * HOUR);
    });

    it('returns the same booking when the same request is sent again', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const bookingId = randomUUID();
      const first = await request(renter, item, at(2), at(4), bookingId);
      const again = await request(renter, item, at(2), at(4), bookingId);
      expect(again.id).toBe(first.id);
      expect(await events(bookingId)).toEqual(['booking.requested.v1']);

      // The same id for another period is a mistake, not a repeat.
      await expect(
        request(renter, item, at(2), at(6), bookingId),
      ).rejects.toEqual(failure('VALIDATION_FAILED'));
      // The same instants written with another offset are a repeat.
      const shifted = (iso: string) =>
        new Date(new Date(iso).getTime() + 2 * HOUR)
          .toISOString()
          .replace('Z', '+02:00');
      await expect(
        request(renter, item, shifted(at(2)), shifted(at(4)), bookingId),
      ).resolves.toMatchObject({ id: first.id });

      // Someone else can't take the id.
      const { renter: other } = await people();
      await expect(
        request(other, item, at(2), at(4), bookingId),
      ).rejects.toEqual(failure('VALIDATION_FAILED'));
    });

    it('refuses own items, unverified renters and unavailable items', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      await expect(request(lender, item)).rejects.toEqual(failure('OWN_ITEM'));

      const unverified = await bookings.addUser({ verified: false });
      await expect(request(unverified, item)).rejects.toEqual(
        failure('EMAIL_NOT_VERIFIED'),
      );

      const paused = await bookings.addItem(lender, { status: 'PAUSED' });
      await expect(request(renter, paused)).rejects.toEqual(
        failure('ITEM_UNAVAILABLE'),
      );
      const draft = await bookings.addItem(lender, { status: 'DRAFT' });
      await expect(request(renter, draft)).rejects.toEqual(
        failure('NOT_FOUND'),
      );
    });

    it('needs a sign-in', async () => {
      const { lender } = await people();
      const item = await bookings.addItem(lender);
      await expect(
        bookings.send(BookingsRpc.request, {
          bookingId: randomUUID(),
          itemId: item.itemId,
          start: at(2),
          end: at(4),
        }),
      ).rejects.toEqual(failure('UNAUTHENTICATED'));
    });

    it('refuses a second overlapping request for the same item', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      await request(renter, item, at(2), at(5));
      await expect(request(renter, item, at(4), at(6))).rejects.toEqual(
        failure('DUPLICATE_REQUEST'),
      );
      // Back to back is fine.
      await request(renter, item, at(5), at(6));
    });

    it(`allows at most ${BOOKING_OPEN_REQUESTS_MAX} open requests`, async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      await Promise.all(
        Array.from({ length: BOOKING_OPEN_REQUESTS_MAX + 3 }, (_, i) =>
          request(renter, item, at(2 + i), at(3 + i)).catch(
            (err: RpcErrorBody) => err,
          ),
        ),
      ).then((results) => {
        const refused = results.filter(
          (r) => (r as RpcErrorBody).code === 'REQUEST_LIMIT_REACHED',
        );
        // Parallel requests are serialised, so exactly the extra ones fail.
        expect(refused).toHaveLength(3);
      });
    });

    it('refuses a period someone already holds', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const first = await request(renter, item, at(2), at(5));
      await act('accept', lender, first.id);

      const { renter: other } = await people();
      await expect(request(other, item, at(4), at(6))).rejects.toEqual(
        failure('SLOT_TAKEN'),
      );
    });
  });

  describe('accept', () => {
    it('accepts a request with something to pay as ACCEPTED', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const booking = await request(renter, item);
      const accepted = await act('accept', lender, booking.id);
      expect(accepted).toMatchObject({
        role: 'LENDER',
        status: 'ACCEPTED',
        expiresAt: null,
      });
      expect(await events(booking.id)).toEqual([
        'booking.requested.v1',
        'booking.accepted.v1',
      ]);
      // Accepting again changes nothing.
      expect((await act('accept', lender, booking.id)).status).toBe('ACCEPTED');
      expect(await events(booking.id)).toHaveLength(2);
    });

    it('confirms a booking with nothing to pay', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender, {
        pricing: { free: true },
        depositCents: 0,
      });
      const booking = await request(renter, item);
      expect(booking.price.totalCents).toBe(0);
      expect((await act('accept', lender, booking.id)).status).toBe(
        'CONFIRMED',
      );
      expect(await events(booking.id)).toEqual([
        'booking.requested.v1',
        'booking.confirmed.v1',
      ]);
    });

    it('declines the overlapping requests in the same transaction', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const { renter: second } = await people();
      const { renter: third } = await people();
      const chosen = await request(renter, item, at(2), at(6));
      const overlapping = await request(second, item, at(5), at(8));
      const later = await request(third, item, at(6), at(8));

      await act('accept', lender, chosen.id);
      expect((await act('get', second, overlapping.id)).status).toBe(
        'DECLINED',
      );
      expect(await events(overlapping.id)).toEqual([
        'booking.requested.v1',
        'booking.declined.v1:OVERLAP',
      ]);
      // [2, 6) and [6, 8) don't overlap.
      expect((await act('get', third, later.id)).status).toBe('REQUESTED');
    });

    it('lets only one of two overlapping requests through when accepted at once', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const { renter: second } = await people();
      const a = await request(renter, item, at(2), at(6));
      const b = await request(second, item, at(4), at(8));

      const results = await Promise.allSettled([
        act('accept', lender, a.id),
        act('accept', lender, b.id),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason).toEqual(
        failure('INVALID_STATE'),
      );
      const statuses = [
        (await act('get', renter, a.id)).status,
        (await act('get', second, b.id)).status,
      ].sort();
      expect(statuses).toEqual(['ACCEPTED', 'DECLINED']);
    });

    it('is for the lender only, and only for requests', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const booking = await request(renter, item);
      await expect(act('accept', renter, booking.id)).rejects.toEqual(
        failure('INVALID_STATE'),
      );
      const { renter: stranger } = await people();
      await expect(act('accept', stranger, booking.id)).rejects.toEqual(
        failure('NOT_FOUND'),
      );
      await act('decline', lender, booking.id);
      await expect(act('accept', lender, booking.id)).rejects.toEqual(
        failure('INVALID_STATE'),
      );
    });
  });

  describe('decline and cancel', () => {
    it('lets the lender decline a request', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const booking = await request(renter, item);
      await expect(act('decline', renter, booking.id)).rejects.toEqual(
        failure('INVALID_STATE'),
      );
      expect(await act('decline', lender, booking.id)).toMatchObject({
        status: 'DECLINED',
        reason: 'LENDER',
      });
      await act('decline', lender, booking.id);
      expect(await events(booking.id)).toEqual([
        'booking.requested.v1',
        'booking.declined.v1:LENDER',
      ]);
    });

    it('lets the renter withdraw a request, but not the lender', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const booking = await request(renter, item);
      await expect(act('cancel', lender, booking.id)).rejects.toEqual(
        failure('INVALID_STATE'),
      );
      expect(await act('cancel', renter, booking.id)).toMatchObject({
        status: 'CANCELLED',
        reason: 'RENTER',
      });
    });

    it('lets either side cancel an accepted booking before it starts', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const first = await request(renter, item, at(2), at(3));
      await act('accept', lender, first.id);
      expect(await act('cancel', lender, first.id)).toMatchObject({
        status: 'CANCELLED',
        reason: 'LENDER',
      });
      // The slot is free again.
      const second = await request(renter, item, at(2), at(3));
      await act('accept', lender, second.id);
      expect((await act('cancel', renter, second.id)).reason).toBe('RENTER');
      expect(await events(second.id)).toEqual([
        'booking.requested.v1',
        'booking.accepted.v1',
        'booking.cancelled.v1:RENTER',
      ]);
    });

    it('refuses to cancel a booking that has started', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender, {
        pricing: { free: true },
        depositCents: 0,
      });
      const booking = await request(renter, item);
      await act('accept', lender, booking.id);
      // Move it into the past, as if time had passed.
      await bookings.dataSource.query(
        `UPDATE bookings SET period = tstzrange(
           date_trunc('hour', now()) - interval '1 hour',
           date_trunc('hour', now()) + interval '2 hours', '[)')
          WHERE id = $1`,
        [booking.id],
      );
      await expect(act('cancel', renter, booking.id)).rejects.toEqual(
        failure('INVALID_STATE'),
      );
    });
  });

  describe('queries', () => {
    it('shows a booking to its two people only', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const booking = await request(renter, item);
      expect((await act('get', lender, booking.id)).role).toBe('LENDER');
      const { renter: stranger } = await people();
      await expect(act('get', stranger, booking.id)).rejects.toEqual(
        failure('NOT_FOUND'),
      );
    });

    it('lists bookings per role, newest first, page by page', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push((await request(renter, item, at(2 + i), at(3 + i))).id);
      }
      await act('decline', lender, ids[0]);

      const token = await as(renter);
      const page1 = await bookings.send(
        BookingsRpc.listMine,
        { role: 'RENTER', limit: 3 },
        token,
      );
      expect(page1.bookings.map((b) => b.id)).toEqual(
        [...ids].reverse().slice(0, 3),
      );
      const page2 = await bookings.send(
        BookingsRpc.listMine,
        { role: 'RENTER', limit: 3, cursor: page1.nextCursor as string },
        token,
      );
      expect(page2.bookings.map((b) => b.id)).toEqual([ids[1], ids[0]]);
      expect(page2.nextCursor).toBeNull();

      const asLender = await bookings.send(
        BookingsRpc.listMine,
        { role: 'LENDER', statuses: ['DECLINED'] },
        await as(lender),
      );
      expect(asLender.bookings.map((b) => b.id)).toEqual([ids[0]]);

      await expect(
        bookings.send(
          BookingsRpc.listMine,
          { role: 'RENTER', cursor: 'not-a-cursor!' },
          token,
        ),
      ).rejects.toEqual(failure('VALIDATION_FAILED'));
    });

    it('shows only the held periods of an item, without people', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const held = await request(renter, item, at(2), at(4));
      await request(renter, item, at(6), at(8));
      await act('accept', lender, held.id);
      expect(
        await bookings.send(BookingsRpc.busyPeriods, { itemId: item.itemId }),
      ).toEqual({ periods: [{ start: at(2), end: at(4) }] });
    });
  });

  describe('erasure and export', () => {
    it("cancels a deleted item's open bookings, once", async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const requested = await request(renter, item, at(2), at(3));
      const accepted = await request(renter, item, at(4), at(5));
      await act('accept', lender, accepted.id);
      const declined = await request(renter, item, at(6), at(7));
      await act('decline', lender, declined.id);

      await bookings.deleteItem(item);
      for (const id of [requested.id, accepted.id]) {
        expect(await act('get', renter, id)).toMatchObject({
          status: 'CANCELLED',
          reason: 'ITEM_DELETED',
        });
      }
      expect((await act('get', renter, declined.id)).status).toBe('DECLINED');
      await expect(request(renter, item)).rejects.toEqual(
        failure('ITEM_UNAVAILABLE'),
      );
    });

    it("cancels a deleted account's open bookings on both sides and keeps the rest without the name", async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const theirItem = await bookings.addItem(renter);
      const { renter: other } = await people();
      const asRenter = await request(renter, item, at(2), at(3));
      const asLender = await request(other, theirItem, at(2), at(3));
      const finished = await request(renter, item, at(4), at(5));
      await act('decline', lender, finished.id);

      await bookings.deleteUser(renter);

      expect(await act('get', lender, asRenter.id)).toMatchObject({
        status: 'CANCELLED',
        reason: 'ACCOUNT_DELETED',
        renter: { userId: renter, displayName: null },
      });
      expect((await act('get', other, asLender.id)).reason).toBe(
        'ACCOUNT_DELETED',
      );
      expect(await act('get', lender, finished.id)).toMatchObject({
        status: 'DECLINED',
        renter: { displayName: null },
      });
      // Its still-valid token can't write anymore.
      await expect(request(renter, item)).rejects.toEqual(
        failure('UNAUTHENTICATED'),
      );
    });

    it('exports the caller’s name, verification and bookings on both sides', async () => {
      const { lender, renter } = await people();
      const item = await bookings.addItem(lender);
      const booking = await request(renter, item);
      const exported = await bookings.send(
        BookingsRpc.exportMe,
        {},
        await as(renter),
      );
      expect(exported).toMatchObject({
        profile: { displayName: 'Rafael' },
        asRenter: [{ id: booking.id, role: 'RENTER' }],
        asLender: [],
      });
      expect(exported.emailVerifiedAt).not.toBeNull();
      const lenderExport = await bookings.send(
        BookingsRpc.exportMe,
        {},
        await as(lender),
      );
      expect(lenderExport.asLender.map((b) => b.id)).toEqual([booking.id]);
    });
  });
});
