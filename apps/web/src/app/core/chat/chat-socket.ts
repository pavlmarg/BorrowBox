import {
  DestroyRef,
  Injectable,
  InjectionToken,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Subject } from 'rxjs';
import { io, type ManagerOptions, type SocketOptions } from 'socket.io-client';
import {
  CHAT_NAMESPACE,
  CHAT_SOCKET_EVENT,
  type ChatPush,
} from '@borrowbox/contracts';
import { AuthStore } from '../auth/auth.store';

/** The part of a Socket.IO client socket this service uses. */
export interface ChatSocketLike {
  connect(): unknown;
  disconnect(): unknown;
  removeAllListeners(): unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

export type ChatSocketFactory = (
  namespace: string,
  options: Partial<ManagerOptions & SocketOptions>,
) => ChatSocketLike;

/** Socket.IO's `io()`; tests swap in a fake. */
export const CHAT_SOCKET_FACTORY = new InjectionToken<ChatSocketFactory>(
  'CHAT_SOCKET_FACTORY',
  { providedIn: 'root', factory: () => io as ChatSocketFactory },
);

/** Backoff after the gateway closed the socket: 1 s, 2 s, 4 s … at most a minute. */
const MAX_RETRY_MS = 60_000;
/** The gateway allows 30 new connections per user per minute. */
const RATE_LIMITED_WAIT_MS = 60_000;

/**
 * Live chat (ADR-0017): one Socket.IO connection to the gateway's `/chat`
 * namespace while signed in. The access token travels in the handshake
 * (`auth.token`), read from memory at every (re)connect, never in the URL.
 * The gateway closes the socket when the token expires (or refuses it):
 * then the token is refreshed and the socket reconnects. Clients only
 * listen; sending is REST. Every connect is announced on `connects`, so
 * pages refetch what a lost push may have missed (no polling).
 */
@Injectable({ providedIn: 'root' })
export class ChatSocket {
  private readonly auth = inject(AuthStore);
  private readonly factory = inject(CHAT_SOCKET_FACTORY);

  private socket: ChatSocketLike | null = null;
  private userId: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Server-side closes in a row, for the backoff. */
  private failures = 0;
  /** Why the gateway refused the last attempt, if it did. */
  private refusal: 'UNAUTHENTICATED' | 'RATE_LIMITED' | null = null;

  private readonly pushSubject = new Subject<ChatPush>();
  private readonly connectSubject = new Subject<void>();
  /** Changes shaped for the signed-in reader. */
  readonly pushes = this.pushSubject.asObservable();
  /** Each successful (re)connection. */
  readonly connects = this.connectSubject.asObservable();
  readonly connected = signal(false);

  constructor() {
    // Connect once signed in, close on sign-out, start over for another user.
    effect(() => {
      const userId = this.auth.isAuthenticated()
        ? (this.auth.user()?.id ?? null)
        : null;
      untracked(() => this.follow(userId));
    });
    inject(DestroyRef).onDestroy(() => this.close());
  }

  private follow(userId: string | null): void {
    if (userId === this.userId) return;
    this.close();
    this.userId = userId;
    if (userId) this.open();
  }

  private open(): void {
    const socket = this.factory(CHAT_NAMESPACE, {
      // Called before every attempt, so a reconnect uses the current token.
      auth: (cb: (data: object) => void) =>
        cb({ token: this.auth.accessToken() ?? '' }),
      withCredentials: true,
    });
    this.socket = socket;
    socket.on('connect', () => {
      this.failures = 0;
      this.refusal = null;
      this.connected.set(true);
      this.connectSubject.next();
    });
    socket.on(CHAT_SOCKET_EVENT, (push: ChatPush) =>
      this.pushSubject.next(push),
    );
    // The gateway says why before closing; never logged (no payloads).
    socket.on('error', (err: { code?: unknown } | undefined) => {
      if (err?.code === 'UNAUTHENTICATED' || err?.code === 'RATE_LIMITED') {
        this.refusal = err.code;
      }
    });
    socket.on('disconnect', (reason: string) => {
      this.connected.set(false);
      // Network drops reconnect by themselves; a close by the gateway
      // (token expired or refused) needs a fresh token first.
      if (reason === 'io server disconnect') this.scheduleReconnect(socket);
    });
  }

  private scheduleReconnect(socket: ChatSocketLike): void {
    const refusal = this.refusal;
    this.refusal = null;
    const delay =
      refusal === 'RATE_LIMITED'
        ? RATE_LIMITED_WAIT_MS
        : this.failures === 0
          ? 0
          : Math.min(1000 * 2 ** (this.failures - 1), MAX_RETRY_MS);
    this.failures++;
    this.clearTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.reconnect(socket, refusal === 'UNAUTHENTICATED');
    }, delay);
  }

  private async reconnect(
    socket: ChatSocketLike,
    forceRefresh: boolean,
  ): Promise<void> {
    if (forceRefresh) {
      await this.auth.refresh();
    } else {
      await this.auth.ensureFresh();
    }
    // Signed out (or another user) meanwhile: that already closed this one.
    if (socket !== this.socket || !this.auth.isAuthenticated()) return;
    socket.connect();
  }

  private clearTimer(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private close(): void {
    this.clearTimer();
    this.failures = 0;
    this.refusal = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected.set(false);
  }
}
