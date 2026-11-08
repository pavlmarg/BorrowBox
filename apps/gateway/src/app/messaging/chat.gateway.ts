import {
  HttpStatus,
  Inject,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
} from '@nestjs/websockets';
import {
  InjectThrottlerStorage,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import Redis from 'ioredis';
import type { Namespace, Socket } from 'socket.io';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
  type AuthUser,
} from '@borrowbox/auth';
import {
  CHAT_CHANNEL_PREFIX,
  CHAT_NAMESPACE,
  CHAT_SOCKET_EVENT,
} from '@borrowbox/contracts';
import type { GatewayConfig } from '../config';

/** New socket connections per user per minute (reconnects after token refreshes are well under this). */
const CONNECTIONS_PER_MINUTE = 30;
const MINUTE = 60_000;
/** How long startup waits for the fan-out subscription before going on without it. */
const SUBSCRIBE_WAIT_MS = 2_000;

/**
 * Live chat delivery (ADR-0017, W2–W4). Sockets authenticate with the access
 * token in the handshake (`auth.token`, never the URL), join their user's
 * room, and are disconnected when the token expires; the client reconnects
 * with a fresh one. Bookings publishes each change on `chat:<userId>`; every
 * gateway instance subscribes and emits to its own sockets. Nothing is sent
 * over the socket by clients: sending is REST. Never logs payloads.
 */
@WebSocketGateway({ namespace: CHAT_NAMESPACE })
export class ChatGateway
  implements OnGatewayConnection, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger('ChatGateway');
  private subscriber?: Redis;
  private closing = false;

  @WebSocketServer() private readonly server!: Namespace;

  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly verifier: AccessTokenVerifier,
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    private readonly config: ConfigService<GatewayConfig, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    // A subscribed connection can't run other commands: its own connection.
    // It connects (and reconnects) by itself, and the subscribe below waits
    // in the offline queue for as long as it takes (no per-command retry
    // limit); once subscribed, ioredis resubscribes after every reconnect.
    this.subscriber = new Redis(this.config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
    });
    this.subscriber.on('error', () => undefined);
    this.subscriber.on('pmessage', (_pattern, channel, payload) =>
      this.fanOut(channel, payload),
    );
    const subscribed = this.subscriber
      .psubscribe(CHAT_CHANNEL_PREFIX + '*')
      .then(() => true);
    // Startup waits a little, never for Redis to come back.
    let timer: NodeJS.Timeout | undefined;
    const gaveUp = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), SUBSCRIBE_WAIT_MS);
      timer.unref();
    });
    const ready = await Promise.race([subscribed, gaveUp]).catch(() => false);
    clearTimeout(timer);
    if (!ready) {
      this.logger.warn(
        'Chat fan-out not subscribed yet: it will be once Redis is reachable',
      );
      subscribed
        .then(() => this.logger.log('Chat fan-out subscribed'))
        .catch((err: unknown) => {
          // Shutting down rejects the queued subscribe: nothing to report.
          if (this.closing) return;
          this.logger.error(
            `Chat fan-out couldn't subscribe: ${err instanceof Error ? err.name : 'unknown'}`,
          );
        });
    }
  }

  async handleConnection(socket: Socket): Promise<void> {
    const token = (socket.handshake.auth as { token?: unknown })?.token;
    if (typeof token !== 'string' || token.length === 0) {
      return this.refuse(socket, 'UNAUTHENTICATED');
    }
    let user: AuthUser;
    try {
      user = await this.verifier.verify(token);
    } catch {
      return this.refuse(socket, 'UNAUTHENTICATED');
    }
    const { isBlocked } = await this.storage.increment(
      `ws:${user.userId}`,
      MINUTE,
      CONNECTIONS_PER_MINUTE,
      MINUTE,
      'ws',
    );
    if (isBlocked) {
      return this.refuse(socket, 'RATE_LIMITED');
    }

    await socket.join(roomOf(user.userId));
    // A socket stays open: close it when its token expires.
    const expiresInMs = user.expiresAt.getTime() - Date.now();
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, expiresInMs),
    );
    timer.unref();
    socket.once('disconnect', () => clearTimeout(timer));
  }

  private fanOut(channel: string, payload: string): void {
    const userId = channel.slice(CHAT_CHANNEL_PREFIX.length);
    try {
      this.server
        .to(roomOf(userId))
        .emit(CHAT_SOCKET_EVENT, JSON.parse(payload));
    } catch {
      this.logger.warn('Dropped a malformed chat push');
    }
  }

  /** Tells the client why, then closes; never echoes the token. */
  private refuse(
    socket: Socket,
    code: 'UNAUTHENTICATED' | 'RATE_LIMITED',
  ): void {
    socket.emit('error', {
      statusCode:
        code === 'RATE_LIMITED'
          ? HttpStatus.TOO_MANY_REQUESTS
          : HttpStatus.UNAUTHORIZED,
      code,
      message:
        code === 'RATE_LIMITED'
          ? 'Too many connections, try again later'
          : 'Authentication required',
    });
    socket.disconnect(true);
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.subscriber?.status === 'ready') {
      await this.subscriber.quit().catch(() => undefined);
    } else {
      this.subscriber?.disconnect();
    }
  }
}

function roomOf(userId: string): string {
  return `user:${userId}`;
}
