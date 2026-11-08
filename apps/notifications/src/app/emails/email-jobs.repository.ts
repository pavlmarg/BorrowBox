import type { EntityManager } from 'typeorm';
import type { EmailKind } from '@borrowbox/contracts';
import type { EmailData, PlannedEmail } from './plan';

export interface EmailJobRow {
  id: string;
  kind: EmailKind;
  recipient_id: string;
  data: EmailData;
  attempts: number;
  created_at: Date;
}

/** Queues emails in the caller's transaction (the consumer's, with processed_events). */
export async function queueEmails(
  tx: EntityManager,
  emails: PlannedEmail[],
): Promise<void> {
  for (const e of emails) {
    await tx.query(
      `INSERT INTO email_jobs (kind, recipient_id, data, next_attempt_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4::float8 / 1000))`,
      [e.kind, e.recipientId, JSON.stringify(e.data), e.delayMs ?? 0],
    );
  }
}

/**
 * Claims up to `limit` due jobs by pushing their next attempt `leaseMs`
 * ahead, so other senders skip them. A sender that crashes mid-send leaves
 * them to be retried after the lease: emails go out at least once.
 */
export async function claimDueJobs(
  tx: EntityManager,
  limit: number,
  leaseMs: number,
): Promise<EmailJobRow[]> {
  // TypeORM returns [rows, rowCount] for UPDATE … RETURNING.
  const [rows]: [EmailJobRow[], number] = await tx.query(
    `UPDATE email_jobs SET next_attempt_at = now() + make_interval(secs => $2::float8 / 1000)
      WHERE id IN (SELECT id FROM email_jobs
                    WHERE status = 'PENDING' AND next_attempt_at <= now()
                    ORDER BY next_attempt_at
                    LIMIT $1::int
                    FOR UPDATE SKIP LOCKED)
      RETURNING id, kind, recipient_id, data, attempts, created_at`,
    [limit, leaseMs],
  );
  return rows;
}

export async function markSent(tx: EntityManager, id: string): Promise<void> {
  await tx.query(
    `UPDATE email_jobs SET status = 'SENT', sent_at = now() WHERE id = $1`,
    [id],
  );
}

export async function markDropped(
  tx: EntityManager,
  id: string,
): Promise<void> {
  await tx.query(`UPDATE email_jobs SET status = 'DROPPED' WHERE id = $1`, [
    id,
  ]);
}

/** Tries again after `delayMs`; counts a failed attempt when `failed`. */
export async function retryLater(
  tx: EntityManager,
  id: string,
  delayMs: number,
  failed: boolean,
): Promise<void> {
  await tx.query(
    `UPDATE email_jobs
        SET next_attempt_at = now() + make_interval(secs => $2::float8 / 1000),
            attempts = attempts + CASE WHEN $3 THEN 1 ELSE 0 END
      WHERE id = $1`,
    [id, delayMs, failed],
  );
}

/** Deletes sent and dropped jobs older than `days`; returns how many. */
export async function pruneJobs(
  tx: EntityManager,
  days: number,
): Promise<number> {
  // TypeORM returns [rows, rowCount] for DELETE.
  const [, deleted]: [unknown[], number] = await tx.query(
    `DELETE FROM email_jobs
      WHERE status <> 'PENDING'
        AND created_at < now() - make_interval(days => $1::int)`,
    [days],
  );
  return deleted;
}

/** The recipient's jobs, oldest first (for the export). */
export async function listJobsOf(
  tx: EntityManager,
  recipientId: string,
): Promise<Array<{ kind: EmailKind; created_at: Date; sent_at: Date | null }>> {
  return tx.query(
    `SELECT kind, created_at, sent_at FROM email_jobs
      WHERE recipient_id = $1 ORDER BY created_at`,
    [recipientId],
  );
}
