import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { UnreadStore } from '../../core/chat/unread.store';
import { tick } from '../../../testing/auth';
import {
  CONVERSATION_ID,
  OTHER_ID,
  conversation,
  message,
  offer,
} from '../../../testing/chat';
import { ThreadStore, mergeMessages } from './thread.store';

const base = `/api/conversations/${CONVERSATION_ID}`;

async function setup() {
  const unread = { refresh: jest.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      ThreadStore,
      { provide: UnreadStore, useValue: unread },
    ],
  });
  const store = TestBed.inject(ThreadStore);
  const http = TestBed.inject(HttpTestingController);
  return { store, http, unread };
}

/** Opens the thread with these messages (newest first, as the API sends them). */
async function open(
  ctx: Awaited<ReturnType<typeof setup>>,
  newestFirst = [message('b'), message('a')],
  overrides: Parameters<typeof conversation>[0] = {},
  nextCursor: string | null = 'older',
) {
  const opening = ctx.store.open(CONVERSATION_ID);
  ctx.http.expectOne(base).flush(conversation(overrides));
  ctx.http
    .expectOne(`${base}/messages`)
    .flush({ messages: newestFirst, nextCursor });
  await opening;
}

const conflict = (code: string) =>
  [
    { statusCode: 409, code, message: code },
    { status: 409, statusText: 'Conflict' },
  ] as const;

describe('mergeMessages', () => {
  it('adds or replaces by id, oldest first', () => {
    const merged = mergeMessages(
      [
        message('a', { sentAt: '2026-11-09T09:00:00.000Z' }),
        message('b', { sentAt: '2026-11-09T09:05:00.000Z' }),
      ],
      [
        message('b', { sentAt: '2026-11-09T09:05:00.000Z', text: 'edited' }),
        message('c', { sentAt: '2026-11-09T08:00:00.000Z' }),
      ],
    );
    expect(merged.map((m) => m.id)).toEqual(['c', 'a', 'b']);
    expect(merged[2].text).toBe('edited');
  });
});

describe('ThreadStore', () => {
  it('opens a conversation, oldest message first', async () => {
    const ctx = await setup();
    await open(ctx, [
      message('new', { sentAt: '2026-11-09T09:05:00.000Z' }),
      message('old', { sentAt: '2026-11-09T09:00:00.000Z' }),
    ]);
    expect(ctx.store.status()).toBe('ready');
    expect(ctx.store.messages().map((m) => m.id)).toEqual(['old', 'new']);
    expect(ctx.store.nextCursor()).toBe('older');
  });

  it('pages in older messages', async () => {
    const ctx = await setup();
    await open(ctx, [message('b', { sentAt: '2026-11-09T09:05:00.000Z' })]);
    const loading = ctx.store.loadOlder();
    ctx.http.expectOne(`${base}/messages?cursor=older`).flush({
      messages: [message('a', { sentAt: '2026-11-09T08:00:00.000Z' })],
      nextCursor: null,
    });
    await loading;
    expect(ctx.store.messages().map((m) => m.id)).toEqual(['a', 'b']);
    expect(ctx.store.nextCursor()).toBeNull();
  });

  it('says when the conversation is not the reader’s', async () => {
    const ctx = await setup();
    const opening = ctx.store.open(CONVERSATION_ID);
    ctx.http
      .expectOne(base)
      .flush(
        { statusCode: 404, code: 'NOT_FOUND', message: 'x' },
        { status: 404, statusText: 'Not Found' },
      );
    ctx.http
      .expectOne(`${base}/messages`)
      .flush({ messages: [], nextCursor: null });
    await opening;
    expect(ctx.store.status()).toBe('error');
    expect(ctx.store.error()?.key).toBe('chat.errors.NOT_FOUND');
  });

  it('sends with an id of its own, and retries with the same id', async () => {
    const ctx = await setup();
    await open(ctx, []);
    const sending = ctx.store.send('hello');
    expect(ctx.store.pending()[0].status).toBe('sending');
    const first = ctx.http.expectOne(`${base}/messages`);
    const id = first.request.body.messageId as string;
    expect(first.request.body.text).toBe('hello');
    first.flush(
      { statusCode: 429, code: 'RATE_LIMITED', message: 'x' },
      { status: 429, statusText: 'Too Many Requests' },
    );
    await sending;
    expect(ctx.store.pending()[0]).toMatchObject({
      status: 'failed',
      errorKey: 'chat.errors.RATE_LIMITED',
    });

    const retrying = ctx.store.retry(id);
    const again = ctx.http.expectOne(`${base}/messages`);
    expect(again.request.body.messageId).toBe(id);
    again.flush(message(id, { mine: true, text: 'hello' }));
    await retrying;
    expect(ctx.store.pending()).toEqual([]);
    expect(ctx.store.messages().map((m) => m.id)).toEqual([id]);
  });

  it('turns read-only when the conversation closed meanwhile', async () => {
    const ctx = await setup();
    await open(ctx, []);
    const sending = ctx.store.send('hello');
    ctx.http
      .expectOne(`${base}/messages`)
      .flush(...conflict('CONVERSATION_CLOSED'));
    await sending;
    expect(ctx.store.closed()).toBe(true);
  });

  it('applies live pushes: messages, reads and offers', async () => {
    const ctx = await setup();
    await open(ctx, [message('mine', { mine: true })]);

    ctx.store.apply({
      type: 'message',
      conversationId: CONVERSATION_ID,
      message: message('theirs', { sentAt: '2026-11-09T09:10:00.000Z' }),
    });
    expect(ctx.store.messages().map((m) => m.id)).toEqual(['mine', 'theirs']);
    expect(ctx.store.unseen()).toBe(true);

    // Someone else's conversation is ignored.
    ctx.store.apply({
      type: 'message',
      conversationId: 'other',
      message: message('x'),
    });
    expect(ctx.store.messages()).toHaveLength(2);

    ctx.store.apply({
      type: 'read',
      conversationId: CONVERSATION_ID,
      readerId: OTHER_ID,
      readAt: '2026-11-09T09:20:00.000Z',
    });
    expect(ctx.store.conversation()?.otherReadAt).toBe(
      '2026-11-09T09:20:00.000Z',
    );

    const open1 = offer();
    ctx.store.apply({
      type: 'message',
      conversationId: CONVERSATION_ID,
      message: message('o', { kind: 'OFFER', text: null, offer: open1 }),
    });
    expect(ctx.store.conversation()?.openOffer?.id).toBe(open1.id);
    ctx.store.apply({
      type: 'offer',
      conversationId: CONVERSATION_ID,
      offer: { ...open1, status: 'WITHDRAWN' },
    });
    expect(ctx.store.conversation()?.openOffer).toBeNull();
    expect(ctx.store.messages().find((m) => m.id === 'o')?.offer?.status).toBe(
      'WITHDRAWN',
    );
  });

  it('reloads everything once contact details unlock', async () => {
    const ctx = await setup();
    await open(ctx);
    ctx.store.apply({
      type: 'message',
      conversationId: CONVERSATION_ID,
      message: message('s', {
        kind: 'SYSTEM',
        text: null,
        senderId: null,
        systemCode: 'BOOKING_CONFIRMED',
      }),
    });
    ctx.http.expectOne(base).flush(conversation());
    ctx.http
      .expectOne(`${base}/messages`)
      .flush({ messages: [message('unmasked')], nextCursor: null });
    await tick();
    expect(ctx.store.messages().map((m) => m.id)).toEqual(['unmasked']);
  });

  it('marks read and refreshes the badge', async () => {
    const ctx = await setup();
    await open(ctx, [message('a')], { unreadCount: 2 });
    expect(ctx.store.unseen()).toBe(true);
    const reading = ctx.store.markRead();
    ctx.http
      .expectOne(`${base}/read`)
      .flush({ readAt: '2026-11-09T10:00:00.000Z' });
    await reading;
    expect(ctx.store.unseen()).toBe(false);
    expect(ctx.store.conversation()?.unreadCount).toBe(0);
    expect(ctx.unread.refresh).toHaveBeenCalled();
  });

  it('sends an offer and reports a price above the list', async () => {
    const ctx = await setup();
    await open(ctx, [], { role: 'LENDER' });
    const sending = ctx.store.sendOffer(
      '2026-11-20T08:00:00.000Z',
      '2026-11-21T08:00:00.000Z',
      2500,
    );
    const req = ctx.http.expectOne(`${base}/offers`);
    expect(req.request.body).toMatchObject({
      start: '2026-11-20T08:00:00.000Z',
      end: '2026-11-21T08:00:00.000Z',
      rentCents: 2500,
    });
    expect(req.request.body.offerId).toMatch(/^[0-9a-f-]{36}$/);
    req.flush(...conflict('PRICE_ABOVE_LIST'));
    expect(await sending).toEqual({
      code: 'PRICE_ABOVE_LIST',
      key: 'chat.errors.PRICE_ABOVE_LIST',
    });
  });

  it('books an offer with the same booking id when tried again', async () => {
    const ctx = await setup();
    await open(ctx, []);
    const o = offer();
    const first = ctx.store.bookOffer(o.id);
    const req1 = ctx.http.expectOne(`/api/offers/${o.id}/book`);
    const bookingId = req1.request.body.bookingId as string;
    req1.error(new ProgressEvent('error'));
    expect(await first).toEqual({
      error: { code: 'NETWORK', key: 'errors.NETWORK' },
    });

    const second = ctx.store.bookOffer(o.id);
    const req2 = ctx.http.expectOne(`/api/offers/${o.id}/book`);
    expect(req2.request.body.bookingId).toBe(bookingId);
    req2.flush({ id: bookingId });
    expect(await second).toEqual({ bookingId });
  });
});
