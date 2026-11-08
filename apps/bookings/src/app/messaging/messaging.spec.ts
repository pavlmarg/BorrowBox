import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  BookingsRpc,
  CHAT_CHANNEL_PREFIX,
  MessagingRpc,
  type ChatPush,
  type ConversationView,
  type ItemSnapshotV1,
  type MessageView,
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
import { ConfigService } from '@nestjs/config';
import type { BookingsConfig } from '../config';
import { ChatMaintenance, REMIND_GAP_MS } from './chat-maintenance';
import { ChatPublisher, ChatPushes } from './chat-publisher';

const HOUR = 60 * 60 * 1000;
const at = (hours: number) =>
  new Date(Math.ceil(Date.now() / HOUR) * HOUR + hours * HOUR).toISOString();

/**
 * In-app chat through real RPC (ADR-0017): conversations, masking, system
 * lines, live pushes in a real Redis, reminders, erasure and retention.
 */
describe('Messaging (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let redis: TestRedis;
  let bookings: BookingsHarness;
  let maintenance: ChatMaintenance;
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
    maintenance = bookings.app.get(ChatMaintenance);
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

  async function setup(
    overrides: Partial<ItemSnapshotV1> = {},
  ): Promise<{ lender: string; renter: string; item: ItemSnapshotV1 }> {
    const lender = await bookings.addUser({ name: 'Lena' });
    const renter = await bookings.addUser({ name: 'Rafael' });
    const item = await bookings.addItem(lender, overrides);
    return { lender, renter, item };
  }

  const start = async (userId: string, itemId: string) =>
    bookings.send(MessagingRpc.start, { itemId }, await as(userId));

  const send = async (
    userId: string,
    conversationId: string,
    text: string,
    messageId = randomUUID(),
  ): Promise<MessageView> =>
    bookings.send(
      MessagingRpc.send,
      { conversationId, messageId, text },
      await as(userId),
    );

  const messages = async (userId: string, conversationId: string) =>
    (
      await bookings.send(
        MessagingRpc.messages,
        { conversationId },
        await as(userId),
      )
    ).messages;

  const get = async (
    userId: string,
    conversationId: string,
  ): Promise<ConversationView> =>
    bookings.send(MessagingRpc.get, { conversationId }, await as(userId));

  describe('conversations', () => {
    it('lets a verified renter start one about an active item, once', async () => {
      const { lender, renter, item } = await setup();
      const c = await start(renter, item.itemId);
      expect(c).toMatchObject({
        itemId: item.itemId,
        itemTitle: 'Cordless drill',
        role: 'RENTER',
        other: { userId: lender, displayName: 'Lena' },
        unreadCount: 0,
        closed: false,
        lastMessage: null,
      });
      expect((await start(renter, item.itemId)).id).toBe(c.id);
    });

    it('refuses own items, unverified askers and unavailable items', async () => {
      const { lender, item } = await setup();
      await expect(start(lender, item.itemId)).rejects.toEqual(
        failure('OWN_ITEM'),
      );
      const unverified = await bookings.addUser({ verified: false });
      await expect(start(unverified, item.itemId)).rejects.toEqual(
        failure('EMAIL_NOT_VERIFIED'),
      );
      const paused = await bookings.addItem(lender, { status: 'PAUSED' });
      const { renter } = await setup();
      await expect(start(renter, paused.itemId)).rejects.toEqual(
        failure('ITEM_UNAVAILABLE'),
      );
    });

    it('shows the lender a conversation only once it has a message', async () => {
      const { lender, renter, item } = await setup();
      const c = await start(renter, item.itemId);
      const list = async () =>
        (
          await bookings.send(MessagingRpc.listMine, {}, await as(lender))
        ).conversations.map((x) => x.id);
      expect(await list()).not.toContain(c.id);
      await send(renter, c.id, 'Is it still available?');
      expect(await list()).toContain(c.id);
    });

    it('keeps conversations private to their two people', async () => {
      const { renter, item } = await setup();
      const c = await start(renter, item.itemId);
      const stranger = await bookings.addUser();
      await expect(get(stranger, c.id)).rejects.toEqual(failure('NOT_FOUND'));
      await expect(send(stranger, c.id, 'hi')).rejects.toEqual(
        failure('NOT_FOUND'),
      );
    });
  });

  describe('messages', () => {
    it('sends once per id, counts unread and marks read', async () => {
      const { lender, renter, item } = await setup();
      const c = await start(renter, item.itemId);
      const messageId = randomUUID();
      const sent = await send(renter, c.id, '  Would you do €20?  ', messageId);
      expect(sent).toMatchObject({
        kind: 'TEXT',
        mine: true,
        text: 'Would you do €20?',
        senderId: renter,
      });
      await send(renter, c.id, 'Would you do €20?', messageId);
      expect(await messages(lender, c.id)).toHaveLength(1);
      expect((await get(lender, c.id)).unreadCount).toBe(1);
      expect(
        await bookings.send(MessagingRpc.unreadCount, {}, await as(lender)),
      ).toEqual({ total: 1 });

      await bookings.send(
        MessagingRpc.markRead,
        { conversationId: c.id },
        await as(lender),
      );
      expect((await get(lender, c.id)).unreadCount).toBe(0);
      expect((await get(renter, c.id)).otherReadAt).not.toBeNull();

      // message.sent carries ids, never the text.
      const [row] = await bookings.dataSource.query(
        `SELECT envelope FROM outbox WHERE routing_key = 'message.sent.v1'
            AND envelope->'payload'->>'messageId' = $1`,
        [messageId],
      );
      expect(row.envelope.payload).toEqual({
        messageId,
        conversationId: c.id,
        itemId: item.itemId,
        senderId: renter,
        recipientId: lender,
        sentAt: sent.sentAt,
      });
      expect(JSON.stringify(row.envelope)).not.toContain('€20');
    });

    it('rejects empty and over-long messages', async () => {
      const { renter, item } = await setup();
      const c = await start(renter, item.itemId);
      for (const text of ['   ', 'α'.repeat(2001)]) {
        await expect(send(renter, c.id, text)).rejects.toEqual(
          failure('VALIDATION_FAILED'),
        );
      }
    });

    it('masks contact details for the other person until a booking goes ahead', async () => {
      const { lender, renter, item } = await setup({
        pricing: { free: true },
        depositCents: 0,
      });
      const c = await start(renter, item.itemId);
      await send(renter, c.id, 'Call me on 6945 123 456');
      expect((await messages(renter, c.id))[0].text).toBe(
        'Call me on 6945 123 456',
      );
      expect((await messages(lender, c.id))[0].text).toBe('Call me on •••');

      const booking = await bookings.send(
        BookingsRpc.request,
        {
          bookingId: randomUUID(),
          itemId: item.itemId,
          start: at(2),
          end: at(4),
        },
        await as(renter),
      );
      // A request alone doesn't unlock it.
      expect(
        (await messages(lender, c.id)).find((m) => m.kind === 'TEXT')?.text,
      ).toBe('Call me on •••');
      await bookings.send(
        BookingsRpc.accept,
        { bookingId: booking.id },
        await as(lender),
      );
      expect(
        (await messages(lender, c.id)).find((m) => m.kind === 'TEXT')?.text,
      ).toBe('Call me on 6945 123 456');
    });

    it('marks booking moments as system lines, creating the conversation if needed', async () => {
      const { lender, renter, item } = await setup();
      const booking = await bookings.send(
        BookingsRpc.request,
        {
          bookingId: randomUUID(),
          itemId: item.itemId,
          start: at(2),
          end: at(4),
        },
        await as(renter),
      );
      await bookings.send(
        BookingsRpc.decline,
        { bookingId: booking.id },
        await as(lender),
      );
      const c = await start(renter, item.itemId);
      const lines = (await messages(renter, c.id)).map((m) => [
        m.kind,
        m.systemCode,
        m.bookingId,
      ]);
      expect(lines).toEqual([
        ['SYSTEM', 'BOOKING_DECLINED', booking.id],
        ['SYSTEM', 'BOOKING_REQUESTED', booking.id],
      ]);
      // System lines don't count as unread.
      expect((await get(renter, c.id)).unreadCount).toBe(0);
    });

    it('pushes new messages to both people over Redis, shaped for each', async () => {
      const { lender, renter, item } = await setup();
      const c = await start(renter, item.itemId);
      const subscriber = new Redis(redis.url);
      const received: Array<{ channel: string; push: ChatPush }> = [];
      try {
        await subscriber.psubscribe(CHAT_CHANNEL_PREFIX + '*');
        subscriber.on('pmessage', (_p, channel, payload) =>
          received.push({ channel, push: JSON.parse(payload) }),
        );
        await send(renter, c.id, 'mail me at r@example.com');
        const deadline = Date.now() + 5_000;
        while (received.length < 2 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
        const byChannel = Object.fromEntries(
          received.map((r) => [r.channel, r.push]),
        );
        expect(byChannel[CHAT_CHANNEL_PREFIX + lender]).toMatchObject({
          type: 'message',
          conversationId: c.id,
          message: { mine: false, text: 'mail me at •••' },
        });
        expect(byChannel[CHAT_CHANNEL_PREFIX + renter]).toMatchObject({
          message: { mine: true, text: 'mail me at r@example.com' },
        });
      } finally {
        await subscriber.quit();
      }
    });

    describe('a fresh publisher (not yet connected)', () => {
      /** Collects every push on `chat:*` while `run` runs. */
      async function collect(expected: number, run: () => Promise<void>) {
        const subscriber = new Redis(redis.url);
        const channels: string[] = [];
        try {
          await subscriber.psubscribe(CHAT_CHANNEL_PREFIX + '*');
          subscriber.on('pmessage', (_p, channel) => channels.push(channel));
          await run();
          const deadline = Date.now() + 5_000;
          while (channels.length < expected && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 50));
          }
          return channels;
        } finally {
          await subscriber.quit();
        }
      }

      async function twoMessages() {
        const a = await setup();
        const b = await setup();
        const ca = await start(a.renter, a.item.itemId);
        const cb = await start(b.renter, b.item.itemId);
        const pushes = [
          await send(a.renter, ca.id, 'first'),
          await send(b.renter, cb.id, 'second'),
        ].map((m) => {
          const p = new ChatPushes();
          p.message(m.id);
          return p;
        });
        return { pushes, people: [a.renter, a.lender, b.renter, b.lender] };
      }

      const freshPublisher = () =>
        new ChatPublisher(bookings.dataSource, {
          get: () => redis.url,
        } as unknown as ConfigService<BookingsConfig, true>);

      it('connects once when its first pushes run at the same time', async () => {
        const publisher = freshPublisher();
        const people = [randomUUID(), randomUUID(), randomUUID()];
        const push: ChatPush = {
          type: 'read',
          conversationId: randomUUID(),
          readerId: randomUUID(),
          readAt: new Date().toISOString(),
        };
        try {
          const channels = await collect(3, async () => {
            // Straight to Redis, so nothing spaces the first pushes apart.
            await Promise.all(people.map((u) => publisher['publish'](u, push)));
          });
          expect(channels.sort()).toEqual(
            people.map((u) => CHAT_CHANNEL_PREFIX + u).sort(),
          );
        } finally {
          await publisher.beforeApplicationShutdown();
        }
      });

      it('keeps pushing after one push fails', async () => {
        const { pushes, people } = await twoMessages();
        const publisher = freshPublisher();
        const both = new ChatPushes();
        both.message(pushes[0].messageIds[0]);
        both.message(pushes[1].messageIds[0]);
        const real = publisher['publish'].bind(publisher);
        jest
          .spyOn(publisher as unknown as { publish: typeof real }, 'publish')
          .mockImplementationOnce(() => Promise.reject(new Error('boom')))
          .mockImplementation(real);
        try {
          const channels = await collect(3, () => publisher.flush(both));
          // Only the first reader's push was lost.
          expect(channels.sort()).toEqual(
            people
              .slice(1)
              .map((u) => CHAT_CHANNEL_PREFIX + u)
              .sort(),
          );
        } finally {
          await publisher.beforeApplicationShutdown();
        }
      });
    });

    it('closes the conversation when the item is deleted', async () => {
      const { renter, item } = await setup();
      const c = await start(renter, item.itemId);
      await bookings.deleteItem(item);
      expect((await get(renter, c.id)).closed).toBe(true);
      await expect(send(renter, c.id, 'hello?')).rejects.toEqual(
        failure('CONVERSATION_CLOSED'),
      );
    });

    it("lets people report the other person's messages only", async () => {
      const { lender, renter, item } = await setup();
      const c = await start(renter, item.itemId);
      const mine = await send(renter, c.id, 'hello');
      const report = async (userId: string, messageId: string) =>
        bookings.send(
          MessagingRpc.report,
          { messageId, reason: 'SPAM' },
          await as(userId),
        );
      await expect(report(renter, mine.id)).rejects.toEqual(
        failure('INVALID_STATE'),
      );
      await report(lender, mine.id);
      await report(lender, mine.id);
      const rows = await bookings.dataSource.query(
        `SELECT reason FROM message_reports WHERE message_id = $1`,
        [mine.id],
      );
      expect(rows).toEqual([{ reason: 'SPAM' }]);
    });
  });

  describe('reminders and retention', () => {
    async function unreadEvents(conversationId: string) {
      return bookings.dataSource.query(
        `SELECT envelope->'payload' AS payload FROM outbox
          WHERE routing_key = 'conversation.unread.v1'
            AND envelope->'payload'->>'conversationId' = $1`,
        [conversationId],
      );
    }

    it('reminds an unread recipient once per 30 minutes, never with the text', async () => {
      const { lender, renter, item } = await setup();
      const c = await start(renter, item.itemId);
      const first = await send(renter, c.id, 'secret plans');
      const second = await send(renter, c.id, 'more');

      expect(await maintenance.remind(first.id)).toBe(true);
      expect(await maintenance.remind(second.id)).toBe(false);
      const later = new Date(Date.now() + REMIND_GAP_MS + 1_000);
      expect(await maintenance.remind(second.id, later)).toBe(true);

      const events = await unreadEvents(c.id);
      expect(events).toHaveLength(2);
      expect(events[0].payload).toEqual({
        conversationId: c.id,
        itemId: item.itemId,
        itemTitle: 'Cordless drill',
        recipientId: lender,
        senderId: renter,
        unreadCount: 2,
      });
      expect(JSON.stringify(events)).not.toContain('secret');
    });

    it("doesn't remind someone who has read it", async () => {
      const { lender, renter, item } = await setup();
      const c = await start(renter, item.itemId);
      const m = await send(renter, c.id, 'hi');
      await bookings.send(
        MessagingRpc.markRead,
        { conversationId: c.id },
        await as(lender),
      );
      expect(await maintenance.remind(m.id)).toBe(false);
      // Replying marks it read for the replier too.
      const reply = await send(lender, c.id, 'hello');
      await send(renter, c.id, 'thanks');
      expect(await maintenance.remind(reply.id)).toBe(false);
    });

    it('deletes conversations idle for two years', async () => {
      const { renter, item } = await setup();
      const c = await start(renter, item.itemId);
      await send(renter, c.id, 'old news');
      await bookings.dataSource.query(
        `UPDATE conversations SET last_message_at = now() - interval '731 days'
          WHERE id = $1`,
        [c.id],
      );
      expect(await maintenance.retention()).toBeGreaterThanOrEqual(1);
      const rows = await bookings.dataSource.query(
        `SELECT 1 FROM messages WHERE conversation_id = $1`,
        [c.id],
      );
      expect(rows).toEqual([]);
    });
  });

  describe('erasure and export', () => {
    it("removes an erased account's text and closes its conversations", async () => {
      const { lender, renter, item } = await setup();
      const c = await start(renter, item.itemId);
      await send(renter, c.id, 'my number is 6945 123 456');
      await send(lender, c.id, 'ok');
      await bookings.deleteUser(renter);

      const seen = await messages(lender, c.id);
      expect(seen.find((m) => m.senderId === renter)).toMatchObject({
        text: null,
        deleted: true,
      });
      expect(seen.find((m) => m.senderId === lender)?.text).toBe('ok');
      expect(await get(lender, c.id)).toMatchObject({
        closed: true,
        other: { displayName: null },
      });
    });

    it('exports the caller’s conversations, own messages as written, offers and reports', async () => {
      const { lender, renter, item } = await setup();
      const c = await start(renter, item.itemId);
      await send(renter, c.id, 'call 6945 123 456');
      const theirs = await send(lender, c.id, 'sure');
      await bookings.send(
        MessagingRpc.report,
        { messageId: theirs.id, reason: 'OTHER' },
        await as(renter),
      );
      const exported = await bookings.send(
        MessagingRpc.exportMe,
        {},
        await as(renter),
      );
      expect(exported.conversations).toEqual([
        expect.objectContaining({
          id: c.id,
          role: 'RENTER',
          myMessages: [expect.objectContaining({ text: 'call 6945 123 456' })],
        }),
      ]);
      expect(exported.reports).toEqual([
        expect.objectContaining({ messageId: theirs.id, reason: 'OTHER' }),
      ]);
      expect(exported.offers).toEqual([]);
    });
  });
});
