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
