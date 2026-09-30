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
  /** Upper bound for the wait after repeated failures (default 30 s). */
  maxBackoffMs?: number;
  /** A row that has failed this many times is logged as an error, not a warning (default 10). */
  alertAfterAttempts?: number;
  logger?: OutboxLogger;
}

/**
 * Wait before the next poll: the poll interval normally, doubling with each
 * consecutive failed batch up to `maxBackoffMs`.
 */
export function relayDelayMs(
  consecutiveFailures: number,
  pollIntervalMs: number,
  maxBackoffMs: number,
): number {
  if (consecutiveFailures <= 0) return pollIntervalMs;
  // Cap the exponent so the multiplication can't overflow to Infinity.
  const factor = 2 ** Math.min(consecutiveFailures, 30);
  return Math.min(
    pollIntervalMs * factor,
    Math.max(maxBackoffMs, pollIntervalMs),
  );
}

interface BatchResult {
  published: number;
  /** True if the batch stopped at a row that failed to publish. */
  failed: boolean;
}

/**
 * Polls `outbox` and publishes unpublished events in insertion order.
 *
 * Rows are claimed with `FOR UPDATE SKIP LOCKED`, so several relay instances
 * can run side by side without publishing the same row twice concurrently.
 * A crash between publish and commit republishes the batch, so delivery is
 * at-least-once — consumers dedupe via `handleOnce`.
 *
 * A row that fails is retried with exponential backoff and never skipped, so
 * later events can't overtake it; after `alertAfterAttempts` failures it is
 * logged as an error.
 */
export class OutboxRelay {
  private readonly dataSource: DataSource;
  private readonly publish: (envelope: EventEnvelope) => Promise<void>;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly alertAfterAttempts: number;
  private readonly logger: OutboxLogger;

  private running = false;
  private loop?: Promise<void>;
  private wake?: () => void;

  constructor(options: OutboxRelayOptions) {
    this.dataSource = options.dataSource;
    this.publish = options.publish;
    this.batchSize = options.batchSize ?? 100;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.alertAfterAttempts = options.alertAfterAttempts ?? 10;
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
    return (await this.publishBatch()).published;
  }

  private publishBatch(): Promise<BatchResult> {
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
      let failed = false;
      for (const row of rows) {
        try {
          await this.publish(row.envelope);
          published.push(row.id);
        } catch (err) {
          failed = true;
          const reason = err instanceof Error ? err.message : String(err);
          // TypeORM returns [rows, rowCount] for UPDATE.
          const [[{ attempts }]]: [Array<{ attempts: number }>, number] =
            await tx.query(
              `UPDATE outbox SET attempts = attempts + 1, last_error = $2
                WHERE id = $1 RETURNING attempts`,
              [row.id, reason.slice(0, 1000)],
            );
          const log = {
            eventId: row.envelope.eventId,
            type: row.envelope.type,
            attempts,
            err: reason,
          };
          if (attempts >= this.alertAfterAttempts) {
            this.logger.error(
              log,
              'Outbox event keeps failing to publish; later events are held back',
            );
          } else {
            this.logger.warn(log, 'Outbox publish failed, will retry');
          }
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
      return { published: published.length, failed };
    });
  }

  private async run(): Promise<void> {
    let consecutiveFailures = 0;
    while (this.running) {
      let result: BatchResult = { published: 0, failed: false };
      try {
        result = await this.publishBatch();
      } catch (err) {
        // e.g. the database is unreachable: back off the same way.
        result = { published: 0, failed: true };
        this.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'Outbox relay batch failed',
        );
      }
      consecutiveFailures = result.failed ? consecutiveFailures + 1 : 0;

      // A full, clean batch means there is probably more waiting: go again at once.
      if (!result.failed && result.published === this.batchSize) continue;
      await this.sleep(
        relayDelayMs(
          consecutiveFailures,
          this.pollIntervalMs,
          this.maxBackoffMs,
        ),
      );
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
