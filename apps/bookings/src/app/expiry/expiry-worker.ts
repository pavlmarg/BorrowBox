import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import type { BookingsConfig } from '../config';
import { BookingExpiry } from './booking-expiry';
import { bullConnection, EXPIRY_QUEUE, ExpiryQueue } from './expiry-queue';

const SWEEP_EVERY_MS = 10 * 60 * 1000;

/**
 * Runs expiry jobs inside the Bookings process and schedules the sweeper.
 * Closed before the database on shutdown, after running jobs finish.
 */
@Injectable()
export class ExpiryWorker
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger('ExpiryWorker');
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService<BookingsConfig, true>,
    private readonly queue: ExpiryQueue,
    private readonly expiry: BookingExpiry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.worker = new Worker(EXPIRY_QUEUE, (job) => this.run(job), {
      connection: bullConnection(this.config.get('REDIS_URL', { infer: true })),
    });
    // Job data is ids only; never log anything else from a job.
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`Job ${job?.name ?? '?'} failed: ${err.name}`),
    );
    this.worker.on('error', (err) =>
      this.logger.error(`Worker error: ${err.name}`),
    );
    await this.queue.queue.upsertJobScheduler(
      'expiry-sweep',
      { every: SWEEP_EVERY_MS },
      { name: 'sweep', data: {} },
    );
  }

  private async run(job: Job): Promise<void> {
    switch (job.name) {
      case 'expire':
        await this.expiry.expire((job.data as { bookingId: string }).bookingId);
        return;
      case 'sweep':
        await this.expiry.sweep();
        return;
      default:
        throw new Error(`Unknown expiry job ${job.name}`);
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
