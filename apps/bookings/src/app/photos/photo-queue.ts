import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { BookingsConfig } from '../config';
import { bullConnection } from '../expiry/expiry-queue';

export const PHOTO_QUEUE = 'bookings-photos';

export type PhotoJob =
  | { name: 'process'; data: { photoId: string } }
  | { name: 'cleanup'; data: Record<string, never> }
  | { name: 'sweep'; data: Record<string, never> };

/**
 * Adds condition photo jobs (BullMQ). Jobs only point at database rows,
 * which are the truth: every job re-checks them, and the sweeper re-adds
 * anything a lost job left behind, so adding after a commit is safe even if
 * Redis hiccups.
 */
@Injectable()
export class PhotoQueue implements BeforeApplicationShutdown {
  private readonly logger = new Logger('PhotoQueue');
  readonly queue: Queue;

  constructor(config: ConfigService<BookingsConfig, true>) {
    this.queue = new Queue(PHOTO_QUEUE, {
      connection: bullConnection(config.get('REDIS_URL', { infer: true })),
      defaultJobOptions: { removeOnComplete: true, removeOnFail: true },
    });
  }

  /** Processes a confirmed upload; one job per photo at a time. */
  async process(photoId: string): Promise<void> {
    await this.add(
      { name: 'process', data: { photoId } },
      {
        jobId: `process-${photoId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    );
  }

  /** Deletes due files listed in `photo_file_deletions`. */
  async cleanup(): Promise<void> {
    await this.add({ name: 'cleanup', data: {} }, { attempts: 3 });
  }

  /**
   * Never throws: the database already holds the truth, and the sweeper
   * re-adds lost work. A failure is logged without any job data.
   */
  private async add(
    job: PhotoJob,
    options: Parameters<Queue['add']>[2],
  ): Promise<void> {
    try {
      await this.queue.add(job.name, job.data, options);
    } catch (err) {
      this.logger.warn(
        `Could not queue ${job.name}: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
