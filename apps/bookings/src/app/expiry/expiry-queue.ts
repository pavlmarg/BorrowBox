import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type RedisOptions } from 'bullmq';
import type { BookingsConfig } from '../config';

export const EXPIRY_QUEUE = 'bookings-expiry';

export type ExpiryJob =
  | { name: 'expire'; data: { bookingId: string } }
  | { name: 'sweep'; data: Record<string, never> };

/** Redis connection options as BullMQ needs them (no per-request retry cap). */
export function bullConnection(url: string): RedisOptions {
  return { url, maxRetriesPerRequest: null };
}

/**
 * Schedules expiry checks (BullMQ delayed jobs). The database is the truth:
 * each job re-checks the booking before acting, and the sweeper catches
 * anything a lost job missed, so scheduling after a commit is safe even if
 * Redis hiccups.
 */
@Injectable()
export class ExpiryQueue implements BeforeApplicationShutdown {
  private readonly logger = new Logger('ExpiryQueue');
  readonly queue: Queue;

  constructor(config: ConfigService<BookingsConfig, true>) {
    this.queue = new Queue(EXPIRY_QUEUE, {
      connection: bullConnection(config.get('REDIS_URL', { infer: true })),
      defaultJobOptions: { removeOnComplete: true, removeOnFail: true },
    });
  }

  /**
   * Checks the booking at `at`. One job per booking and time, so a request's
   * deadline and an accepted booking's start are separate jobs. Never
   * throws: a failure is logged without job data.
   */
  async checkAt(bookingId: string, at: Date): Promise<void> {
    try {
      await this.queue.add(
        'expire',
        { bookingId },
        {
          jobId: `expire-${bookingId}-${at.getTime()}`,
          delay: Math.max(0, at.getTime() - Date.now()),
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      );
    } catch (err) {
      this.logger.warn(
        `Could not schedule an expiry: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
