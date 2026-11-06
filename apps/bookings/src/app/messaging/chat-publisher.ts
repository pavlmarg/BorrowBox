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

  async flush(pushes: ChatPushes): Promise<void> {
    try {
      const tx = this.dataSource.manager;
      for (const id of pushes.messageIds) {
        const message = await findMessage(tx, id);
        const c =
          message && (await findConversation(tx, message.conversation_id));
        if (!message || !c) continue;
        for (const reader of [c.renter_id, c.lender_id]) {
          await this.publish(reader, {
            type: 'message',
            conversationId: c.id,
            message: toMessageView(message, reader, c.unlocked),
          });
        }
      }
      for (const id of pushes.offerIds) {
        const offer = await findOffer(tx, id);
        if (!offer) continue;
        for (const reader of [offer.renter_id, offer.lender_id]) {
          await this.publish(reader, {
            type: 'offer',
            conversationId: offer.conversation_id,
            offer: toOfferView(offer),
          });
        }
      }
      for (const read of pushes.reads) {
        const c = await findConversation(tx, read.conversationId);
        if (!c) continue;
        const other = c.renter_id === read.readerId ? c.lender_id : c.renter_id;
        await this.publish(other, {
          type: 'read',
          conversationId: c.id,
          readerId: read.readerId,
          readAt: read.readAt.toISOString(),
        });
      }
    } catch (err) {
      this.logger.warn(
        `Live push failed: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
  }

  private async publish(userId: string, push: ChatPush): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
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
