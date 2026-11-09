import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router, provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { Subject, of } from 'rxjs';
import type { ChatPush } from '@borrowbox/contracts';
import type {
  ConversationViewResponse,
  MessageViewResponse,
} from '../../api/models';
import { ChatSocket } from '../../core/chat/chat-socket';
import { UnreadStore } from '../../core/chat/unread.store';
import { tick } from '../../../testing/auth';
import {
  CONVERSATION_ID,
  OTHER_ID,
  conversation,
  message,
  offer,
} from '../../../testing/chat';
import { ThreadPage, sendable } from './thread.page';

const base = `/api/conversations/${CONVERSATION_ID}`;

async function render(
  newestFirst: MessageViewResponse[],
  overrides: Partial<ConversationViewResponse> = {},
  confirm = true,
) {
  const socket = {
    pushes: new Subject<ChatPush>(),
    connects: new Subject<void>(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideTransloco({
        config: { availableLangs: ['el', 'en'], defaultLang: 'en' },
      }),
      { provide: ChatSocket, useValue: socket },
      { provide: UnreadStore, useValue: { refresh: jest.fn() } },
      {
        provide: MatDialog,
        useValue: { open: () => ({ afterClosed: () => of(confirm) }) },
      },
    ],
  });
  const fixture = TestBed.createComponent(ThreadPage);
  fixture.componentRef.setInput('id', CONVERSATION_ID);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne(base).flush(conversation(overrides));
  http
    .expectOne(`${base}/messages`)
    .flush({ messages: newestFirst, nextCursor: null });
  await tick();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const texts = (selector: string) =>
    [...el.querySelectorAll(selector)].map((n) =>
      n.textContent?.replace(/\s+/g, ' ').trim(),
    );
  return { fixture, el, http, socket, texts };
}

describe('sendable', () => {
  it('needs 1–2000 characters once trimmed', () => {
    expect(sendable('  ')).toBe(false);
    expect(sendable(' hi ')).toBe(true);
    expect(sendable('x'.repeat(2000))).toBe(true);
    expect(sendable('x'.repeat(2001))).toBe(false);
  });
});

describe('ThreadPage', () => {
  it('shows messages, system lines, "seen" and why details are hidden', async () => {
    const { el, texts } = await render(
      [
        message('their-masked', {
          text: 'call me on •••',
          sentAt: '2026-11-09T09:20:00.000Z',
        }),
        message('sys', {
          kind: 'SYSTEM',
          senderId: null,
          text: null,
          systemCode: 'BOOKING_REQUESTED',
          bookingId: 'b-1',
          sentAt: '2026-11-09T09:10:00.000Z',
        }),
        message('mine', {
          mine: true,
          senderId: 'me',
          text: 'Is it free on Saturday?',
          sentAt: '2026-11-09T09:00:00.000Z',
        }),
      ],
      { otherReadAt: '2026-11-09T09:05:00.000Z' },
    );
    expect(texts('h1.name')).toEqual(['Maria']);
    expect(el.querySelector('a.item')?.getAttribute('href')).toBe(
      `/items/${conversation().itemId}`,
    );
    expect(texts('.msg .bubble')).toEqual([
      'Is it free on Saturday?',
      'call me on •••',
    ]);
    expect(texts('.msg.mine .seen')).toEqual(['chat.seen']);
    expect(texts('.system span:first-child')).toEqual([
      'chat.system.BOOKING_REQUESTED',
    ]);
    expect(el.querySelector('.system a')?.getAttribute('href')).toBe(
      '/bookings/b-1',
    );
    expect(texts('.masked')).toEqual(['chat.maskedHint']);
    // Only the other person's messages can be reported.
    expect(el.querySelectorAll('.msg.mine .report')).toHaveLength(0);
    expect(el.querySelectorAll('.msg:not(.mine) .report')).toHaveLength(1);
  });

  it('marks the thread read while it is open', async () => {
    const { http } = await render([message('a')], { unreadCount: 1 });
    http
      .expectOne(`${base}/read`)
      .flush({ readAt: '2026-11-09T10:00:00.000Z' });
  });

  it('sends on Enter, not on Shift+Enter, and shows it while sending', async () => {
    const { el, fixture, http, texts } = await render([]);
    const box = el.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'Hello there';
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }),
    );
    http.expectNone(`${base}/messages`);

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(box.value).toBe('');
    expect(texts('.pending .bubble')).toEqual(['Hello there']);
    const req = http.expectOne(
      (r) => r.method === 'POST' && r.url === `${base}/messages`,
    );
    expect(req.request.body.text).toBe('Hello there');
    req.flush(
      message(req.request.body.messageId, { mine: true, text: 'Hello there' }),
    );
    await tick();
    await fixture.whenStable();
    expect(texts('.pending')).toEqual([]);
    expect(texts('.msg.mine .bubble')).toEqual(['Hello there']);
  });

  it('adds messages pushed live', async () => {
    const { fixture, socket, texts, http } = await render([]);
    socket.pushes.next({
      type: 'message',
      conversationId: CONVERSATION_ID,
      message: message('live', { text: 'Just arrived' }),
    });
    await fixture.whenStable();
    expect(texts('.msg .bubble')).toEqual(['Just arrived']);
    // It's visible: read at once.
    http.expectOne(`${base}/read`);
  });

  it('is read-only once closed', async () => {
    const { el, texts } = await render([message('a')], { closed: true });
    expect(texts('.closed')).toEqual(['chat.closedBanner']);
    expect(el.querySelector('textarea')).toBeNull();
  });

  it('lets the renter book an open offer, then opens the booking', async () => {
    const o = offer();
    const { el, fixture, http } = await render([
      message('o', { kind: 'OFFER', text: null, senderId: OTHER_ID, offer: o }),
    ]);
    expect(el.textContent).not.toContain('offers.make');
    const book = [...el.querySelectorAll('bb-offer-card button')].find(
      (b) => b.textContent?.trim() === 'offers.book',
    ) as HTMLButtonElement;
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    book.click();
    await tick();
    const req = http.expectOne(`/api/offers/${o.id}/book`);
    req.flush({ id: req.request.body.bookingId });
    await tick();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith([
      '/bookings',
      req.request.body.bookingId,
    ]);
  });

  it('lets the lender make offers and withdraw the open one', async () => {
    const o = offer();
    const { el, http } = await render(
      [message('o', { kind: 'OFFER', text: null, mine: true, offer: o })],
      { role: 'LENDER', openOffer: o },
    );
    expect(el.querySelector('.tools')?.textContent).toContain('offers.make');
    // The lender sees no fee or total: that's what the renter pays.
    expect(el.querySelector('bb-offer-card')?.textContent).not.toContain(
      'offers.total',
    );
    const withdraw = [...el.querySelectorAll('bb-offer-card button')].find(
      (b) => b.textContent?.trim() === 'offers.withdraw',
    ) as HTMLButtonElement;
    withdraw.click();
    await tick();
    http
      .expectOne(`/api/offers/${o.id}/withdraw`)
      .flush({ ...o, status: 'WITHDRAWN' });
  });
});
