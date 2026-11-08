import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import { CHAT_CHANNEL_PREFIX, type ChatPush } from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import type { BookingsConfig } from '../config';
import {
  findConversation,
  findMessage,
  findOffer,
} from './messaging.repository';
import { toMessageView, toOfferView } from './views';

/**
 * What a transaction changed in chat, collected while it runs and pushed
 * once it has committed (so nobody sees a message that then rolls back).
 */
export class ChatPushes {
  readonly messageIds: string[] = [];
  readonly offerIds: string[] = [];
  readonly reads: Array<{
    conversationId: string;
    readerId: string;
    readAt: Date;
  }> = [];

  message(id: string): void {
    this.messageIds.push(id);
  }

  offer(id: string): void {
    this.offerIds.push(id);
  }

  read(conversationId: string, readerId: string, readAt: Date): void {
    this.reads.push({ conversationId, readerId, readAt });
  }
}

/**
 * Live delivery (ADR-0017): publishes each change on the Redis channel
 * `chat:<userId>` of the people it concerns, already shaped for each reader
 * (masking included). The gateway pushes it to their sockets. Never throws
 * and never logs content: a lost push is fetched on the next reconnect.
 */
@Injectable()
export class ChatPublisher implements BeforeApplicationShutdown {
  private readonly logger = new Logger('ChatPublisher');
  private readonly redis: Redis;
  private connecting?: Promise<void>;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    config: ConfigService<BookingsConfig, true>,
  ) {
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    this.redis.on('error', () => undefined);
  }

  /**
   * Pushes everything collected. Each change is pushed on its own: one that
   * fails (Redis down, a read failing) doesn't hold back the others, and
   * the failures are logged once, counted, without content.
   */
  async flush(pushes: ChatPushes): Promise<void> {
    const tx = this.dataSource.manager;
    let failed = 0;
    let firstError: unknown;
    const attempt = async (push: () => Promise<void>) => {
      try {
        await push();
      } catch (err) {
        failed++;
        firstError ??= err;
      }
    };

    for (const id of pushes.messageIds) {
      await attempt(async () => {
        const message = await findMessage(tx, id);
        const c =
          message && (await findConversation(tx, message.conversation_id));
        if (!message || !c) return;
        for (const reader of [c.renter_id, c.lender_id]) {
          await attempt(() =>
            this.publish(reader, {
              type: 'message',
              conversationId: c.id,
              message: toMessageView(message, reader, c.unlocked),
            }),
          );
        }
      });
    }
    for (const id of pushes.offerIds) {
      await attempt(async () => {
        const offer = await findOffer(tx, id);
        if (!offer) return;
        for (const reader of [offer.renter_id, offer.lender_id]) {
          await attempt(() =>
            this.publish(reader, {
              type: 'offer',
              conversationId: offer.conversation_id,
              offer: toOfferView(offer),
            }),
          );
        }
      });
    }
    for (const read of pushes.reads) {
      await attempt(async () => {
        const c = await findConversation(tx, read.conversationId);
        if (!c) return;
        const other = c.renter_id === read.readerId ? c.lender_id : c.renter_id;
        await this.publish(other, {
          type: 'read',
          conversationId: c.id,
          readerId: read.readerId,
          readAt: read.readAt.toISOString(),
        });
      });
    }

    if (failed > 0) {
      // The error's class and code only: messages can quote values.
      const err = firstError as { name?: string; code?: string } | undefined;
      this.logger.warn(
        `${failed} live push(es) failed: ${err?.name ?? 'unknown'}` +
          (err?.code ? ` (${err.code})` : ''),
      );
    }
  }

  /**
   * Connects on first use, once: concurrent first pushes wait for the same
   * connection (with the offline queue off, a publish while connecting
   * fails).
   */
  private async connected(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.redis.status !== 'wait') return;
    this.connecting = this.redis.connect().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async publish(userId: string, push: ChatPush): Promise<void> {
    await this.connected();
    await this.redis.publish(
      CHAT_CHANNEL_PREFIX + userId,
      JSON.stringify(push),
    );
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') {
      await this.redis.quit().catch(() => undefined);
    } else {
      this.redis.disconnect();
    }
  }
}
