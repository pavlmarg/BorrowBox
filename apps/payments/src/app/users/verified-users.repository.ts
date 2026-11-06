import type { EntityManager } from 'typeorm';

/**
 * Who has a verified email (A6), from Identity's events, which may arrive
 * late or more than once: the first verification counts, and deletion is
 * final (a late event never brings a deleted user back).
 */

export interface VerifiedUserRow {
  user_id: string;
  email_verified_at: Date | null;
  deleted_at: Date | null;
}

/** From `user.email_verified`. */
export async function saveVerified(
  tx: EntityManager,
  userId: string,
  occurredAt: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO verified_users (user_id, email_verified_at)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET email_verified_at = EXCLUDED.email_verified_at
       WHERE verified_users.deleted_at IS NULL
         AND verified_users.email_verified_at IS NULL`,
    [userId, occurredAt],
  );
}

/** From `user.deletion_requested`; keeps the id so a late event can't add them back. */
export async function markUserDeleted(
  tx: EntityManager,
  userId: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO verified_users (user_id, deleted_at)
     VALUES ($1, now())
     ON CONFLICT (user_id) DO UPDATE
       SET email_verified_at = NULL,
           deleted_at = COALESCE(verified_users.deleted_at, now())`,
    [userId],
  );
}

export async function findUser(
  tx: EntityManager,
  userId: string,
): Promise<VerifiedUserRow | null> {
  const [row] = await tx.query(
    `SELECT * FROM verified_users WHERE user_id = $1`,
    [userId],
  );
  return row ?? null;
}
