import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import type { BookingsConfig } from '../config';
import { bullConnection } from '../expiry/expiry-queue';
import { ChatMaintenance } from './chat-maintenance';
import { CHAT_QUEUE, ChatQueue } from './chat-queue';

const RETENTION_EVERY_MS = 24 * 60 * 60 * 1000;

/** Runs chat jobs inside the Bookings process and schedules the daily retention sweep. */
@Injectable()
export class ChatWorker
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger('ChatWorker');
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService<BookingsConfig, true>,
    private readonly queue: ChatQueue,
    private readonly maintenance: ChatMaintenance,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.worker = new Worker(CHAT_QUEUE, (job) => this.run(job), {
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
      'chat-retention',
      { every: RETENTION_EVERY_MS },
      { name: 'retention', data: {} },
    );
  }

  private async run(job: Job): Promise<void> {
    switch (job.name) {
      case 'remind':
        await this.maintenance.remind(
          (job.data as { messageId: string }).messageId,
        );
        return;
      case 'retention':
        await this.maintenance.retention();
        return;
      default:
        throw new Error(`Unknown chat job ${job.name}`);
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
