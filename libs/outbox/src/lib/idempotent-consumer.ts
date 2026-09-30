import type { DataSource, EntityManager } from 'typeorm';
import type { EventEnvelope } from '@borrowbox/contracts';

/**
 * Runs `sideEffect` at most once per (consumer, eventId). The processed_events
 * row and the side effect commit in the same transaction, so a crash or a
 * thrown error leaves neither behind and the event can be retried.
 *
 * Concurrent deliveries of the same event block on the primary key until the
 * first transaction finishes, then skip.
 *
 * @param consumer stable name for this handler, e.g. its queue name
 * @returns true if the side effect ran, false if the event was a duplicate
 */
export async function handleOnce(
  dataSource: DataSource,
  consumer: string,
  envelope: Pick<EventEnvelope, 'eventId'>,
  sideEffect: (tx: EntityManager) => Promise<void>,
): Promise<boolean> {
  return dataSource.transaction(async (tx) => {
    const inserted: unknown[] = await tx.query(
      `INSERT INTO processed_events (consumer, event_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING event_id`,
      [consumer, envelope.eventId],
    );
    if (inserted.length === 0) return false;
    await sideEffect(tx);
    return true;
  });
}

/**
 * How long published outbox rows and processed_events entries are kept by
 * default. Redeliveries arrive within minutes, and old envelopes can hold
 * personal data, so a week is plenty for dedupe and debugging.
 */
export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deletes processed_events entries older than `olderThanMs`. Call it
 * periodically from a consuming service. Returns how many were deleted.
 */
export async function pruneProcessedEvents(
  dataSource: DataSource,
  olderThanMs: number = DEFAULT_RETENTION_MS,
): Promise<number> {
  // TypeORM returns [rows, rowCount] for DELETE.
  const [, deleted]: [unknown[], number] = await dataSource.query(
    `DELETE FROM processed_events WHERE processed_at < $1`,
    [new Date(Date.now() - olderThanMs)],
  );
  return deleted;
}
