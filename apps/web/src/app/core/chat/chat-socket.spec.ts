import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ChatPush } from '@borrowbox/contracts';
import { AuthStore } from '../auth/auth.store';
import {
  CHAT_SOCKET_FACTORY,
  ChatSocket,
  type ChatSocketLike,
} from './chat-socket';

type Handler = (...args: unknown[]) => void;

class FakeSocket implements ChatSocketLike {
  readonly handlers = new Map<string, Handler[]>();
  connects = 0;
  disconnects = 0;
  connect() {
    this.connects++;
  }
  disconnect() {
    this.disconnects++;
  }
  removeAllListeners() {
    this.handlers.clear();
  }
  on(event: string, listener: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
  }
  fire(event: string, ...args: unknown[]) {
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }
}

function setup() {
  const sockets: Array<{
    socket: FakeSocket;
    options: Record<string, unknown>;
  }> = [];
  const auth = {
    isAuthenticated: signal(false),
    user: signal<{ id: string } | null>(null),
    accessToken: signal<string | null>(null),
    refresh: jest.fn(async () => {
      auth.accessToken.set('fresh');
      return true;
    }),
    ensureFresh: jest.fn(async () => undefined),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthStore, useValue: auth },
      {
        provide: CHAT_SOCKET_FACTORY,
        useValue: (_ns: string, options: Record<string, unknown>) => {
          const socket = new FakeSocket();
          sockets.push({ socket, options });
          return socket;
        },
      },
    ],
  });
  const chat = TestBed.inject(ChatSocket);
  const signIn = (id = 'u-1', token = 'access-1') => {
    auth.user.set({ id });
    auth.accessToken.set(token);
    auth.isAuthenticated.set(true);
    TestBed.tick();
  };
  return { chat, auth, sockets, signIn };
}

/** The token the handshake would send now. */
function handshakeToken(options: Record<string, unknown>): unknown {
  let token: unknown;
  (options['auth'] as (cb: (d: { token: string }) => void) => void)((d) => {
    token = d.token;
  });
  return token;
}

describe('ChatSocket', () => {
  afterEach(() => jest.useRealTimers());

  it('connects only while signed in, with the token from memory', () => {
    const { sockets, signIn, auth } = setup();
    TestBed.tick();
    expect(sockets).toHaveLength(0);

    signIn();
    expect(sockets).toHaveLength(1);
    expect(handshakeToken(sockets[0].options)).toBe('access-1');
    // A reconnect asks again, so it uses whatever token is current.
    auth.accessToken.set('access-2');
    expect(handshakeToken(sockets[0].options)).toBe('access-2');
  });

  it('passes pushes on and announces every connect', () => {
    const { chat, sockets, signIn } = setup();
    signIn();
    const pushes: ChatPush[] = [];
    let connects = 0;
    chat.pushes.subscribe((p) => pushes.push(p));
    chat.connects.subscribe(() => connects++);
    const socket = sockets[0].socket;

    socket.fire('connect');
    const push = {
      type: 'read',
      conversationId: 'c',
      readerId: 'u-2',
      readAt: '2026-11-09T10:00:00.000Z',
    } as const;
    socket.fire('chat', push);
    socket.fire('connect');

    expect(pushes).toEqual([push]);
    expect(connects).toBe(2);
    expect(chat.connected()).toBe(true);
  });

  it('refreshes the token and reconnects after the gateway closed the socket', async () => {
    jest.useFakeTimers();
    const { auth, sockets, signIn } = setup();
    signIn();
    const socket = sockets[0].socket;
    socket.fire('connect');

    // The token expired: the gateway closes without an error.
    socket.fire('disconnect', 'io server disconnect');
    await jest.advanceTimersByTimeAsync(0);
    expect(auth.ensureFresh).toHaveBeenCalled();
    expect(socket.connects).toBe(1);

    // Refused: refresh for real, then try again after a backoff.
    socket.fire('error', { code: 'UNAUTHENTICATED' });
    socket.fire('disconnect', 'io server disconnect');
    await jest.advanceTimersByTimeAsync(999);
    expect(auth.refresh).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(socket.connects).toBe(2);
  });

  it('waits a minute when the gateway says too many connections', async () => {
    jest.useFakeTimers();
    const { sockets, signIn } = setup();
    signIn();
    const socket = sockets[0].socket;
    socket.fire('error', { code: 'RATE_LIMITED' });
    socket.fire('disconnect', 'io server disconnect');
    await jest.advanceTimersByTimeAsync(59_999);
    expect(socket.connects).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(socket.connects).toBe(1);
  });

  it('leaves network drops to Socket.IO', async () => {
    jest.useFakeTimers();
    const { auth, sockets, signIn } = setup();
    signIn();
    sockets[0].socket.fire('disconnect', 'transport close');
    await jest.advanceTimersByTimeAsync(120_000);
    expect(auth.ensureFresh).not.toHaveBeenCalled();
    expect(sockets[0].socket.connects).toBe(0);
  });

  it('disconnects on sign-out and starts over for another user', () => {
    const { auth, sockets, signIn } = setup();
    signIn('u-1');
    const first = sockets[0].socket;

    auth.isAuthenticated.set(false);
    TestBed.tick();
    expect(first.disconnects).toBe(1);
    expect(first.handlers.size).toBe(0);

    signIn('u-2');
    expect(sockets).toHaveLength(2);
  });
});
