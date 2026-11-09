import type { EntityManager } from 'typeorm';
import type { WebhookSource } from '@borrowbox/contracts';
import type { VerifiedEvent } from '../stripe/stripe-api';

export interface StripeEventRow {
  event_id: string;
  type: string;
  source: WebhookSource;
  account_id: string | null;
  object_id: string | null;
  attempts: number;
}

/**
 * Records a verified event once (Stripe may send it again). Returns whether
 * it was new.
 */
export async function insertEvent(
  tx: EntityManager,
  source: WebhookSource,
  event: VerifiedEvent,
): Promise<boolean> {
  // INSERT … RETURNING gives the rows (only UPDATE/DELETE add a count).
  const rows: unknown[] = await tx.query(
    `INSERT INTO stripe_events (event_id, type, source, account_id, object_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [event.id, event.type, source, event.accountId, event.objectId],
  );
  return rows.length > 0;
}

/**
 * Claims up to `limit` unprocessed events by pushing their next attempt
 * `leaseMs` ahead, so other workers skip them; a worker that crashes leaves
 * them to be retried after the lease.
 */
export async function claimDueEvents(
  tx: EntityManager,
  limit: number,
  leaseMs: number,
): Promise<StripeEventRow[]> {
  const [rows]: [StripeEventRow[], number] = await tx.query(
    `UPDATE stripe_events
        SET next_attempt_at = now() + make_interval(secs => $2::float8 / 1000)
      WHERE event_id IN (SELECT event_id FROM stripe_events
                          WHERE processed_at IS NULL AND next_attempt_at <= now()
                          ORDER BY received_at
                          LIMIT $1::int
                          FOR UPDATE SKIP LOCKED)
      RETURNING event_id, type, source, account_id, object_id, attempts`,
    [limit, leaseMs],
  );
  return rows;
}

export async function markProcessed(
  tx: EntityManager,
  eventId: string,
): Promise<void> {
  await tx.query(
    `UPDATE stripe_events SET processed_at = now() WHERE event_id = $1`,
    [eventId],
  );
}

/** Tries again after `delayMs`, counting a failed attempt. */
export async function retryEventLater(
  tx: EntityManager,
  eventId: string,
  delayMs: number,
): Promise<void> {
  await tx.query(
    `UPDATE stripe_events
        SET next_attempt_at = now() + make_interval(secs => $2::float8 / 1000),
            attempts = attempts + 1
      WHERE event_id = $1`,
    [eventId, delayMs],
  );
}

/** Deletes processed events older than `days`; returns how many. */
export async function pruneStripeEvents(
  tx: EntityManager,
  days: number,
): Promise<number> {
  // TypeORM returns [rows, rowCount] for DELETE.
  const [, deleted]: [unknown[], number] = await tx.query(
    `DELETE FROM stripe_events
      WHERE processed_at IS NOT NULL
        AND received_at < now() - make_interval(days => $1::int)`,
    [days],
  );
  return deleted;
}
