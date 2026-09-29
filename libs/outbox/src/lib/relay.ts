import type { DataSource } from 'typeorm';
import type { EventEnvelope } from '@borrowbox/contracts';

/** Structured logger (pino-compatible). Never pass payloads — they may hold personal data. */
export interface OutboxLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface OutboxRelayOptions {
  dataSource: DataSource;
  /** Must resolve only once the broker has confirmed (e.g. `EventBus.publish`). */
  publish: (envelope: EventEnvelope) => Promise<void>;
  batchSize?: number;
  pollIntervalMs?: number;
  logger?: OutboxLogger;
}

/**
 * Polls `outbox` and publishes unpublished events in insertion order.
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED`, so several relay instances
 * can run side by side without publishing the same row twice concurrently.
 * A crash between publish and commit republishes the batch, so delivery is
 * at-least-once — consumers dedupe via `handleOnce`.
 */
export class OutboxRelay {
  private readonly dataSource: DataSource;
  private readonly publish: (envelope: EventEnvelope) => Promise<void>;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly logger: OutboxLogger;

  private running = false;
  private loop?: Promise<void>;
  private wake?: () => void;

  constructor(options: OutboxRelayOptions) {
    this.dataSource = options.dataSource;
    this.publish = options.publish;
    this.batchSize = options.batchSize ?? 100;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.logger = options.logger ?? {
      warn: (obj, msg) => console.warn(msg, obj),
      error: (obj, msg) => console.error(msg, obj),
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  /** Stops polling and waits for an in-flight batch to finish. */
  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
  }

  /**
   * Publishes one batch. Stops at the first failure so later events are not
   * published ahead of an earlier one. Returns the number published.
   */
  async publishPending(): Promise<number> {
    return this.dataSource.transaction(async (tx) => {
      const rows: Array<{ id: string; envelope: EventEnvelope }> =
        await tx.query(
          `SELECT id, envelope FROM outbox
            WHERE published_at IS NULL
            ORDER BY id
            LIMIT $1
            FOR UPDATE SKIP LOCKED`,
          [this.batchSize],
        );

      const published: string[] = [];
      for (const row of rows) {
        try {
          await this.publish(row.envelope);
          published.push(row.id);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            {
              eventId: row.envelope.eventId,
              type: row.envelope.type,
              err: reason,
            },
            'Outbox publish failed, will retry',
          );
          await tx.query(
            `UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
            [row.id, reason.slice(0, 1000)],
          );
          break;
        }
      }

      if (published.length > 0) {
        await tx.query(
          `UPDATE outbox
              SET published_at = now(), attempts = attempts + 1, last_error = NULL
            WHERE id = ANY($1::bigint[])`,
          [published],
        );
      }
      return published.length;
    });
  }

  private async run(): Promise<void> {
    while (this.running) {
      let published = 0;
      try {
        published = await this.publishPending();
      } catch (err) {
        this.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'Outbox relay batch failed',
        );
      }
      // A full batch means there is probably more waiting: go again at once.
      if (published < this.batchSize) await this.sleep(this.pollIntervalMs);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }
}
