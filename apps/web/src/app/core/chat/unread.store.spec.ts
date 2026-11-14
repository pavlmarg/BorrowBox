import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { ChatPush } from '@borrowbox/contracts';
import { tick } from '../../../testing/auth';
import { AuthStore } from '../auth/auth.store';
import { ChatSocket } from './chat-socket';
import { UNREAD_REFRESH_DELAY_MS, UnreadStore } from './unread.store';

function setup(signedIn: boolean) {
  const socket = {
    pushes: new Subject<ChatPush>(),
    connects: new Subject<void>(),
  };
  const auth = { isAuthenticated: signal(signedIn) };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthStore, useValue: auth },
      { provide: ChatSocket, useValue: socket },
    ],
  });
  const store = TestBed.inject(UnreadStore);
  TestBed.tick();
  return {
    store,
    auth,
    socket,
    http: TestBed.inject(HttpTestingController),
  };
}

describe('UnreadStore', () => {
  afterEach(() => jest.useRealTimers());

  it('loads the count once signed in, and zeroes it on sign-out', async () => {
    const { store, auth, http } = setup(true);
    http.expectOne('/api/me/unread').flush({ total: 3 });
    await tick();
    expect(store.total()).toBe(3);

    auth.isAuthenticated.set(false);
    TestBed.tick();
    await tick();
    expect(store.total()).toBe(0);
    http.verify();
  });

  it('asks nothing while signed out', () => {
    const { store, http } = setup(false);
    http.verify();
    expect(store.total()).toBe(0);
  });

  it('reloads after a reconnect, and once for a burst of pushes', async () => {
    const { store, socket, http } = setup(true);
    http.expectOne('/api/me/unread').flush({ total: 0 });
    await tick();

    socket.connects.next();
    http.expectOne('/api/me/unread').flush({ total: 1 });
    await tick();
    expect(store.total()).toBe(1);

    jest.useFakeTimers();
    const push = {
      type: 'read',
      conversationId: 'c',
      readerId: 'u',
      readAt: '2026-11-09T10:00:00.000Z',
    } as const;
    socket.pushes.next(push);
    socket.pushes.next(push);
    jest.advanceTimersByTime(UNREAD_REFRESH_DELAY_MS);
    jest.useRealTimers();
    http.expectOne('/api/me/unread').flush({ total: 2 });
    await tick();
    expect(store.total()).toBe(2);
    http.verify();
  });
});
