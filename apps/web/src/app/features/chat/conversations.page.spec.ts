import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTransloco } from '@jsverse/transloco';
import { Subject } from 'rxjs';
import type { ChatPush } from '@borrowbox/contracts';
import type { ConversationViewResponse } from '../../api/models';
import { ChatSocket } from '../../core/chat/chat-socket';
import { tick } from '../../../testing/auth';
import { conversation, message, offer } from '../../../testing/chat';
import { ConversationsPage } from './conversations.page';

async function render(
  conversations: ConversationViewResponse[],
  nextCursor: string | null = null,
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
    ],
  });
  const fixture = TestBed.createComponent(ConversationsPage);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/me/conversations').flush({ conversations, nextCursor });
  await tick();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const rows = () =>
    [...el.querySelectorAll('a.row')].map((row) => ({
      href: row.getAttribute('href'),
      name: row.querySelector('.name')?.textContent?.trim(),
      preview: row.querySelector('.preview')?.textContent?.trim(),
      unread: row.classList.contains('unread'),
    }));
  return { fixture, el, http, socket, rows };
}

describe('ConversationsPage', () => {
  it('highlights the open conversation and clears its unread count, once', async () => {
    const { fixture, rows, el, socket } = await render([
      conversation({ id: 'c1', unreadCount: 2 }),
      conversation({ id: 'c2', unreadCount: 1 }),
    ]);
    fixture.componentRef.setInput('activeId', 'c1');
    await fixture.whenStable();
    expect(rows().map((r) => r.unread)).toEqual([false, true]);
    expect(el.querySelector('a.row.active')?.getAttribute('href')).toBe(
      '/messages/c1',
    );

    // A message in the open conversation isn't counted as unread.
    socket.pushes.next({
      type: 'message',
      conversationId: 'c1',
      message: message('m9', { text: 'Hi' }),
    } as ChatPush);
    await fixture.whenStable();
    expect(rows()[0].unread).toBe(false);
  });

  it('says so when there are none yet', async () => {
    const { el } = await render([]);
    expect(el.textContent).toContain('chat.empty');
    expect(el.querySelector('a[href="/explore"]')).not.toBeNull();
  });

  it('lists conversations with the last message and unread state', async () => {
    const { rows } = await render([
      conversation({
        id: 'c1',
        unreadCount: 2,
        lastMessage: message('m1', { text: 'Is it still free?' }),
      }),
      conversation({
        id: 'c2',
        other: { userId: 'x', displayName: null },
        lastMessage: message('m2', { mine: true, text: 'Thanks!' }),
      }),
      conversation({
        id: 'c3',
        lastMessage: message('m3', {
          kind: 'OFFER',
          text: null,
          offer: offer(),
        }),
      }),
    ]);
    expect(rows()).toEqual([
      {
        href: '/messages/c1',
        name: 'Maria',
        preview: 'Is it still free?',
        unread: true,
      },
      {
        href: '/messages/c2',
        name: 'chat.deletedUser',
        preview: 'chat.youSaid',
        unread: false,
      },
      {
        href: '/messages/c3',
        name: 'Maria',
        preview: 'offers.preview',
        unread: false,
      },
    ]);
  });

  it('moves a conversation to the top when a message arrives', async () => {
    const { fixture, socket, rows } = await render([
      conversation({ id: 'c1', lastMessageAt: '2026-11-09T10:00:00.000Z' }),
      conversation({ id: 'c2', lastMessageAt: '2026-11-09T09:00:00.000Z' }),
    ]);
    socket.pushes.next({
      type: 'message',
      conversationId: 'c2',
      message: message('new', {
        conversationId: 'c2',
        text: 'New!',
        sentAt: '2026-11-09T11:00:00.000Z',
      }),
    });
    await fixture.whenStable();
    expect(rows().map((r) => [r.href, r.preview, r.unread])).toEqual([
      ['/messages/c2', 'New!', true],
      ['/messages/c1', 'chat.noMessages', false],
    ]);
  });

  it('pages in more conversations', async () => {
    const { el, fixture, http, rows } = await render(
      [conversation({ id: 'c1' })],
      'next',
    );
    (el.querySelector('.more button') as HTMLButtonElement).click();
    http
      .expectOne('/api/me/conversations?cursor=next')
      .flush({ conversations: [conversation({ id: 'c2' })], nextCursor: null });
    await tick();
    await fixture.whenStable();
    expect(rows().map((r) => r.href)).toEqual(['/messages/c1', '/messages/c2']);
    expect(el.querySelector('.more')).toBeNull();
  });
});
