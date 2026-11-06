import type { EntityManager } from 'typeorm';
import type { Locale } from '@borrowbox/contracts';

/**
 * Who Notifications can email, from Identity's events. Events may arrive
 * late or out of order, so the newest `occurredAt` wins for the name and
 * language, an email address is kept once known (only `user.registered`
 * carries it), and deletion is final.
 */

export interface RecipientRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  locale: Locale | null;
  updated_at: Date;
  deleted_at: Date | null;
}

/** From `user.registered` (also re-sent by `identity:republish-registered`). */
export async function saveRegistered(
  tx: EntityManager,
  r: {
    userId: string;
    email: string;
    displayName: string;
    locale: Locale;
    occurredAt: string;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO recipients (user_id, email, display_name, locale, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE
       SET email = CASE
             WHEN recipients.email IS NULL
               OR recipients.updated_at < EXCLUDED.updated_at
             THEN EXCLUDED.email ELSE recipients.email END,
           display_name = CASE
             WHEN recipients.updated_at < EXCLUDED.updated_at
             THEN EXCLUDED.display_name ELSE recipients.display_name END,
           locale = CASE
             WHEN recipients.updated_at < EXCLUDED.updated_at
             THEN EXCLUDED.locale ELSE recipients.locale END,
           updated_at = GREATEST(recipients.updated_at, EXCLUDED.updated_at)
       WHERE recipients.deleted_at IS NULL`,
    [r.userId, r.email, r.displayName, r.locale, r.occurredAt],
  );
}

/** From `user.profile_updated`: name and language; creates the row without an email. */
export async function saveProfile(
  tx: EntityManager,
  r: {
    userId: string;
    displayName: string;
    locale: Locale;
    occurredAt: string;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO recipients (user_id, display_name, locale, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           locale = EXCLUDED.locale,
           updated_at = EXCLUDED.updated_at
       WHERE recipients.deleted_at IS NULL
         AND recipients.updated_at < EXCLUDED.updated_at`,
    [r.userId, r.displayName, r.locale, r.occurredAt],
  );
}

/**
 * From `user.deletion_requested`: forgets the person and their emails, and
 * keeps the id so late events can't bring them back.
 */
export async function forgetRecipient(
  tx: EntityManager,
  userId: string,
  occurredAt: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO recipients (user_id, updated_at, deleted_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE
       SET email = NULL, display_name = NULL, locale = NULL,
           deleted_at = COALESCE(recipients.deleted_at, now())`,
    [userId, occurredAt],
  );
  await tx.query(`DELETE FROM email_jobs WHERE recipient_id = $1`, [userId]);
}

export async function findRecipient(
  tx: EntityManager,
  userId: string,
): Promise<RecipientRow | null> {
  const [row] = await tx.query(`SELECT * FROM recipients WHERE user_id = $1`, [
    userId,
  ]);
  return row ?? null;
}
