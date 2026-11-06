import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { BookingsConfig } from '../config';
import { bullConnection } from '../expiry/expiry-queue';

export const CHAT_QUEUE = 'bookings-chat';

/** How long a message waits unread before its recipient may get an email. */
export const REMIND_AFTER_MS = 2 * 60 * 1000;

export type ChatJob =
  | { name: 'remind'; data: { messageId: string } }
  | { name: 'retention'; data: Record<string, never> };

/**
 * Chat's background jobs (BullMQ): the unread-message reminder, and the
 * daily retention sweep. Jobs only point at rows, which every job re-reads.
 */
@Injectable()
export class ChatQueue implements BeforeApplicationShutdown {
  private readonly logger = new Logger('ChatQueue');
  readonly queue: Queue;

  constructor(config: ConfigService<BookingsConfig, true>) {
    this.queue = new Queue(CHAT_QUEUE, {
      connection: bullConnection(config.get('REDIS_URL', { infer: true })),
      defaultJobOptions: { removeOnComplete: true, removeOnFail: true },
    });
  }

  /** Checks in 2 minutes whether the message is still unread. Never throws. */
  async remindLater(
    messageId: string,
    delayMs = REMIND_AFTER_MS,
  ): Promise<void> {
    try {
      await this.queue.add(
        'remind',
        { messageId },
        {
          jobId: `remind-${messageId}`,
          delay: delayMs,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      );
    } catch (err) {
      this.logger.warn(
        `Could not schedule a reminder: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
