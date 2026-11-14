import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import type { IdentityConfig } from '../config';
import { PhotoMaintenance } from './photo-maintenance';
import { PhotoProcessor } from './photo-processor';
import { bullConnection, PHOTO_QUEUE, PhotoQueue } from './photo-queue';

/** Two photos at a time: image decoding is CPU- and memory-heavy. */
const CONCURRENCY = 2;
const SWEEP_EVERY_MS = 10 * 60 * 1000;

/**
 * Runs profile photo jobs inside the Identity process, and schedules the
 * sweeper. Closed before the database on shutdown, after letting running
 * jobs finish.
 */
@Injectable()
export class PhotoWorker
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger('PhotoWorker');
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService<IdentityConfig, true>,
    private readonly queue: PhotoQueue,
    private readonly processor: PhotoProcessor,
    private readonly maintenance: PhotoMaintenance,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.worker = new Worker(PHOTO_QUEUE, (job) => this.run(job), {
      connection: bullConnection(this.config.get('REDIS_URL', { infer: true })),
      concurrency: CONCURRENCY,
    });
    // Job data is ids only; never log anything else from a job.
    this.worker.on('failed', (job, err) =>
      this.logger.warn(`Job ${job?.name ?? '?'} failed: ${err.name}`),
    );
    this.worker.on('error', (err) =>
      this.logger.error(`Worker error: ${err.name}`),
    );
    await this.queue.queue.upsertJobScheduler(
      'photo-sweep',
      { every: SWEEP_EVERY_MS },
      { name: 'sweep', data: {} },
    );
  }

  private async run(job: Job): Promise<void> {
    switch (job.name) {
      case 'process':
        return this.processor.process(
          (job.data as { uploadId: string }).uploadId,
        );
      case 'cleanup':
        await this.maintenance.cleanup();
        return;
      case 'sweep':
        await this.maintenance.sweep();
        return;
      default:
        throw new Error(`Unknown photo job ${job.name}`);
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
