import { randomUUID } from 'node:crypto';
import {
  BookingsRpc,
  createEnvelope,
  MessagingRpc,
  PaymentAccountRestrictedV1,
  type ItemSnapshotV1,
  type OfferView,
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
const at = (hours: number) =>
  new Date(Math.ceil(Date.now() / HOUR) * HOUR + hours * HOUR).toISOString();

/** Price offers in chat (ADR-0018), through real RPC and Postgres. */
describe('Offers (integration)', () => {
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
  const failure = (code: string) =>
    expect.objectContaining<Partial<RpcErrorBody>>({ code });

  /** A lender, a renter, an item at €2/hour + €10/day with a €50 deposit, and their conversation. */
  async function setup(overrides: Partial<ItemSnapshotV1> = {}) {
    const lender = await bookings.addUser({ name: 'Lena' });
    const renter = await bookings.addUser({ name: 'Rafael' });
    const item = await bookings.addItem(lender, overrides);
    const c = await bookings.send(
      MessagingRpc.start,
      { itemId: item.itemId },
      await as(renter),
    );
    return { lender, renter, item, conversationId: c.id };
  }

  async function offer(
    lender: string,
    conversationId: string,
    rentCents: number,
    start = at(4),
    end = at(28),
    offerId = randomUUID(),
  ): Promise<OfferView> {
    return bookings.send(
      MessagingRpc.sendOffer,
      { conversationId, offerId, start, end, rentCents },
      await as(lender),
    );
  }

  const book = async (
    renter: string,
    offerId: string,
    bookingId = randomUUID(),
  ) =>
    bookings.send(
      MessagingRpc.bookOffer,
      { offerId, bookingId },
      await as(renter),
    );

  async function outbox(routingKey: string, key: string, value: string) {
    return bookings.dataSource.query(
      `SELECT envelope->'payload' AS payload FROM outbox
        WHERE routing_key = $1 AND envelope->'payload'->>$2 = $3 ORDER BY id`,
      [routingKey, key, value],
    );
  }

  it('lets the lender offer a discount, shown as a card in the chat', async () => {
    const { lender, renter, conversationId } = await setup();
    // 24 hours: the rate card says €10.
    const sent = await offer(lender, conversationId, 800);
    expect(sent).toMatchObject({
      rentCents: 800,
      depositCents: 5000,
      // The renter's fee on the offer price (ADR-0020): 10% of €8.
      feeCents: 80,
      totalCents: 5880,
      listRentCents: 1000,
      status: 'OPEN',
      bookingId: null,
    });
    const { messages } = await bookings.send(
      MessagingRpc.messages,
      { conversationId },
      await as(renter),
    );
    expect(messages[0]).toMatchObject({
      kind: 'OFFER',
      senderId: lender,
      offer: { id: sent.id, rentCents: 800, status: 'OPEN' },
    });
    const conversation = await bookings.send(
      MessagingRpc.get,
      { conversationId },
      await as(renter),
    );
    expect(conversation.openOffer?.id).toBe(sent.id);
    expect(await outbox('offer.sent.v1', 'offerId', sent.id)).toHaveLength(1);
  });

  it('refuses offers above the listed price, from the renter, or breaking period rules', async () => {
    const { lender, renter, conversationId } = await setup({
      maxRentalHours: 48,
    });
    await expect(offer(lender, conversationId, 1001)).rejects.toEqual(
      failure('PRICE_ABOVE_LIST'),
    );
    await expect(offer(renter, conversationId, 500)).rejects.toEqual(
      failure('INVALID_STATE'),
    );
    await expect(
      offer(lender, conversationId, 500, at(4), at(100)),
    ).rejects.toEqual(failure('INVALID_PERIOD'));
  });

  it('keeps one open offer per conversation: a new one replaces it', async () => {
    const { lender, renter, conversationId } = await setup();
    const first = await offer(lender, conversationId, 900);
    const second = await offer(lender, conversationId, 700);
    const [withdrawn] = await outbox('offer.withdrawn.v1', 'offerId', first.id);
    expect(withdrawn.payload.reason).toBe('REPLACED');
    await expect(book(renter, first.id)).rejects.toEqual(
      failure('OFFER_UNAVAILABLE'),
    );
    expect((await book(renter, second.id)).price.rentCents).toBe(700);
  });

  it('books an offer straight to ACCEPTED at its price, once', async () => {
    const { lender, renter, item, conversationId } = await setup();
    const { renter: other } = await (async () => ({
      renter: await bookings.addUser(),
    }))();
    // Someone else's request for the same time, and the renter's own.
    const theirs = await bookings.send(
      BookingsRpc.request,
      {
        bookingId: randomUUID(),
        itemId: item.itemId,
        start: at(4),
        end: at(6),
      },
      await as(other),
    );
    const own = await bookings.send(
      BookingsRpc.request,
      {
        bookingId: randomUUID(),
        itemId: item.itemId,
        start: at(4),
        end: at(28),
      },
      await as(renter),
    );

    const sent = await offer(lender, conversationId, 600);
    const bookingId = randomUUID();
    const booking = await book(renter, sent.id, bookingId);
    expect(booking).toMatchObject({
      status: 'ACCEPTED',
      role: 'RENTER',
      price: {
        rentCents: 600,
        depositCents: 5000,
        feeCents: 72,
        totalCents: 5672,
        lenderFeeCents: 150,
        payoutCents: 450,
        offerId: sent.id,
      },
    });
    // Repeating returns the same booking; using it again is refused.
    expect((await book(renter, sent.id, bookingId)).id).toBe(booking.id);
    await expect(book(renter, sent.id)).rejects.toEqual(
      failure('OFFER_UNAVAILABLE'),
    );

    const events = await outbox('booking.requested.v1', 'bookingId', bookingId);
    expect(events[0].payload).toMatchObject({
      rentCents: 600,
      offerId: sent.id,
    });
    expect(
      await outbox('booking.accepted.v1', 'bookingId', bookingId),
    ).toHaveLength(1);
    for (const declined of [theirs, own]) {
      expect(
        await bookings.send(
          BookingsRpc.get,
          { bookingId: declined.id },
          await as(declined.renter.userId),
        ),
      ).toMatchObject({ status: 'DECLINED', reason: 'OVERLAP' });
    }
    const after = await bookings.send(
      MessagingRpc.get,
      { conversationId },
      await as(lender),
    );
    expect(after.openOffer).toBeNull();
  });

  it('confirms an offer with nothing to pay', async () => {
    const { lender, renter, conversationId } = await setup({ depositCents: 0 });
    const sent = await offer(lender, conversationId, 0);
    expect((await book(renter, sent.id)).status).toBe('CONFIRMED');
  });

  it('refuses withdrawn, expired and taken offers', async () => {
    const { lender, renter, item, conversationId } = await setup();
    const withdrawn = await offer(lender, conversationId, 500);
    await bookings.send(
      MessagingRpc.withdrawOffer,
      { offerId: withdrawn.id },
      await as(lender),
    );
    await expect(book(renter, withdrawn.id)).rejects.toEqual(
      failure('OFFER_UNAVAILABLE'),
    );

    const expired = await offer(lender, conversationId, 500);
    await bookings.dataSource.query(
      `UPDATE offers SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [expired.id],
    );
    await expect(book(renter, expired.id)).rejects.toEqual(
      failure('OFFER_UNAVAILABLE'),
    );

    const taken = await offer(lender, conversationId, 300, at(40), at(42));
    const other = await bookings.addUser();
    const theirs = await bookings.send(
      BookingsRpc.request,
      {
        bookingId: randomUUID(),
        itemId: item.itemId,
        start: at(41),
        end: at(43),
      },
      await as(other),
    );
    await bookings.send(
      BookingsRpc.accept,
      { bookingId: theirs.id },
      await as(lender),
    );
    await expect(book(renter, taken.id)).rejects.toEqual(failure('SLOT_TAKEN'));
  });

  describe('booking an offer while the item or the lender is deleted', () => {
    /** An open offer, and another renter's overlapping request it will decline. */
    async function raceSetup() {
      const s = await setup();
      const sent = await offer(s.lender, s.conversationId, 500);
      const other = await bookings.addUser();
      await bookings.send(
        BookingsRpc.request,
        {
          bookingId: randomUUID(),
          itemId: s.item.itemId,
          start: at(5),
          end: at(7),
        },
        await as(other),
      );
      return { ...s, offerId: sent.id };
    }

    /** Both finish: the booking goes ahead or is refused, never a deadlock (INTERNAL). */
    async function race(
      deletion: () => Promise<void>,
      booking: Promise<unknown>,
    ) {
      const [booked, deleted] = await Promise.allSettled([booking, deletion()]);
      expect(deleted.status).toBe('fulfilled');
      if (booked.status === 'rejected') {
        expect(['OFFER_UNAVAILABLE', 'ITEM_UNAVAILABLE']).toContain(
          (booked.reason as RpcErrorBody).code,
        );
      }
    }

    async function openBookings(itemId: string) {
      const [{ n }] = await bookings.dataSource.query(
        `SELECT count(*)::int AS n FROM bookings
          WHERE item_id = $1
            AND status IN ('REQUESTED','ACCEPTED','CONFIRMED','PAID')`,
        [itemId],
      );
      return n;
    }

    it('never deadlocks with the item’s deletion', async () => {
      for (let round = 0; round < 5; round++) {
        const { renter, item, offerId } = await raceSetup();
        await race(() => bookings.deleteItem(item), book(renter, offerId));
        expect(await openBookings(item.itemId)).toBe(0);
      }
    });

    it('never deadlocks with the lender’s erasure', async () => {
      for (let round = 0; round < 5; round++) {
        const { lender, renter, item, offerId } = await raceSetup();
        await race(() => bookings.deleteUser(lender), book(renter, offerId));
        expect(await openBookings(item.itemId)).toBe(0);
      }
    });
  });

  describe("the lender's payouts (ADR-0019)", () => {
    it('are needed to offer a booking with something to pay', async () => {
      const lender = await bookings.addUser({ name: 'Lena', payable: false });
      const renter = await bookings.addUser({ name: 'Rafael' });
      const item = await bookings.addItem(lender);
      const c = await bookings.send(
        MessagingRpc.start,
        { itemId: item.itemId },
        await as(renter),
      );
      await expect(offer(lender, c.id, 500)).rejects.toEqual(
        failure('PAYOUTS_NOT_SET_UP'),
      );
    });

    it('are checked again when the offer is booked', async () => {
      const { lender, renter, conversationId } = await setup();
      const sent = await offer(lender, conversationId, 500);
      await bookings.receive(
        createEnvelope(PaymentAccountRestrictedV1, { userId: lender }),
      );
      await expect(book(renter, sent.id)).rejects.toEqual(
        failure('PAYOUTS_NOT_SET_UP'),
      );
      // Nothing was booked; the offer is still open.
      expect(
        await outbox('booking.requested.v1', 'offerId', sent.id),
      ).toHaveLength(0);
    });
  });

  it('withdraws open offers when the item is deleted', async () => {
    const { lender, renter, item, conversationId } = await setup();
    const sent = await offer(lender, conversationId, 500);
    await bookings.deleteItem(item);
    const [event] = await outbox('offer.withdrawn.v1', 'offerId', sent.id);
    expect(event.payload.reason).toBe('ITEM_DELETED');
    await expect(book(renter, sent.id)).rejects.toEqual(
      failure('OFFER_UNAVAILABLE'),
    );
  });
});
