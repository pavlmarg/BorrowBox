import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { Mailer } from '@borrowbox/mailer';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import type { NotificationsConfig } from '../config';
import { findRecipient } from '../recipients/recipients.repository';
import {
  claimDueJobs,
  markDropped,
  markSent,
  pruneJobs,
  retryLater,
  type EmailJobRow,
} from './email-jobs.repository';
import { renderNotification } from './templates';

export const MAILER = Symbol('MAILER');

const POLL_MS = 2_000;
const BATCH = 20;
/** A claimed job is retried after this if its sender dies mid-send. */
const LEASE_MS = 2 * 60 * 1000;
/** Waiting for the recipient's email address (it may arrive late). */
const WAIT_FOR_RECIPIENT_MS = 5 * 60 * 1000;
/** Undeliverable after a day: dropped, never sent late. */
const GIVE_UP_MS = 24 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
/** Sent and dropped jobs are kept this long (ADR-0016, export). */
export const KEEP_JOBS_DAYS = 30;

/**
 * Sends queued emails (N3): polls `email_jobs`, renders each in the
 * recipient's language at send time, and retries with backoff for up to a
 * day. At least once: a crash between sending and marking sent repeats an
 * email, which beats losing it. Logs never contain addresses or content.
 */
@Injectable()
export class EmailSender
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger('EmailSender');
  private readonly webBaseUrl: string;
  private pollTimer?: NodeJS.Timeout;
  private pruneTimer?: NodeJS.Timeout;
  private running?: Promise<number>;
  private stopped = false;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(MAILER) private readonly mailer: Mailer,
    config: ConfigService<NotificationsConfig, true>,
  ) {
    this.webBaseUrl = config.get('WEB_BASE_URL', { infer: true });
  }

  onApplicationBootstrap(): void {
    this.pollTimer = setInterval(() => void this.tick(), POLL_MS);
    this.pollTimer.unref();
    this.pruneTimer = setInterval(() => void this.prune(), PRUNE_EVERY_MS);
    this.pruneTimer.unref();
  }

  /** Sends everything due now; returns how many were sent. One run at a time. */
  async sendDue(now = new Date()): Promise<number> {
    if (this.running) return this.running;
    this.running = this.run(now).finally(() => (this.running = undefined));
    return this.running;
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.sendDue();
    } catch (err) {
      this.logger.warn(
        `Send loop failed: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
  }

  private async run(now: Date): Promise<number> {
    let sent = 0;
    for (;;) {
      const jobs = await this.dataSource.transaction((tx) =>
        claimDueJobs(tx, BATCH, LEASE_MS),
      );
      for (const job of jobs) {
        try {
          if (await this.deliver(job, now)) sent++;
        } catch (err) {
          // e.g. the database blinked: this job is retried after its lease,
          // and the rest of the batch still goes out.
          this.logger.warn(
            `Email ${job.kind} job ${job.id} failed: ${err instanceof Error ? err.name : 'unknown'}`,
          );
        }
      }
      if (jobs.length < BATCH || this.stopped) return sent;
    }
  }

  private async deliver(job: EmailJobRow, now: Date): Promise<boolean> {
    const tx = this.dataSource.manager;
    const tooOld = now.getTime() - job.created_at.getTime() > GIVE_UP_MS;
    const recipient = await findRecipient(tx, job.recipient_id);
    if (recipient?.deleted_at) {
      await markDropped(tx, job.id);
      return false;
    }
    if (!recipient?.email || !recipient.display_name || !recipient.locale) {
      if (tooOld) await markDropped(tx, job.id);
      else await retryLater(tx, job.id, WAIT_FOR_RECIPIENT_MS, false);
      return false;
    }

    const other = await findRecipient(tx, job.data.otherId);
    let email: ReturnType<typeof renderNotification>;
    try {
      email = renderNotification({
        kind: job.kind,
        data: job.data,
        locale: recipient.locale,
        recipientName: recipient.display_name,
        otherName: other?.deleted_at ? null : (other?.display_name ?? null),
        webBaseUrl: this.webBaseUrl,
      });
    } catch (err) {
      // A job that can't be rendered never will be: drop it rather than
      // claiming it again every lease, forever.
      this.logger.error(
        `Email ${job.kind} job ${job.id} can't be rendered, dropped: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      await markDropped(tx, job.id);
      return false;
    }
    try {
      // Without an SMTP host nothing is sent: a failed attempt like any
      // other, so the email still goes out if the host is set within a day.
      if (!this.mailer.enabled) {
        throw new Error('Email sending is disabled (no SMTP host)');
      }
      await this.mailer.send({ to: recipient.email, ...email });
    } catch (err) {
      this.logger.warn(
        `Email ${job.kind} failed (attempt ${job.attempts + 1}): ${err instanceof Error ? err.message : 'unknown'}`,
      );
      if (tooOld) await markDropped(tx, job.id);
      else
        await retryLater(
          tx,
          job.id,
          Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** job.attempts),
          true,
        );
      return false;
    }
    await markSent(tx, job.id);
    return true;
  }

  /** Forgets old sent and dropped jobs; never throws. */
  async prune(): Promise<void> {
    try {
      const deleted = await pruneJobs(this.dataSource.manager, KEEP_JOBS_DAYS);
      if (deleted > 0) this.logger.log(`Pruned ${deleted} email job(s)`);
    } catch (err) {
      this.logger.warn(
        `Prune failed: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
  }

  /** Stops polling and lets a running batch finish before the DataSource closes. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.pruneTimer);
    await this.running?.catch(() => undefined);
    this.mailer.close();
  }
}
