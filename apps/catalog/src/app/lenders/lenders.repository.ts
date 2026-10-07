import type { EntityManager } from 'typeorm';

/**
 * The `lenders` read model: every account's display name, kept from
 * Identity's events. Events may arrive late or out of order, so:
 * - the newest `occurredAt` wins for the name;
 * - deletion is final: later name events never bring a deleted user back.
 */

/** From `user.registered` or `user.profile_updated`; creates the row if missing. */
export async function saveLenderName(
  tx: EntityManager,
  userId: string,
  displayName: string,
  occurredAt: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO lenders (user_id, display_name, name_updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           name_updated_at = EXCLUDED.name_updated_at
       WHERE lenders.deleted_at IS NULL
         AND lenders.name_updated_at < EXCLUDED.name_updated_at`,
    [userId, displayName, occurredAt],
  );
}

/**
 * From `user.deletion_requested`. Keeps a row with only the id even for a
 * user Catalog never heard of, so a late `user.registered` can't add the
 * name back.
 */
export async function markLenderDeleted(
  tx: EntityManager,
  userId: string,
  occurredAt: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO lenders (user_id, display_name, name_updated_at, deleted_at)
     VALUES ($1, NULL, $2, now())
     ON CONFLICT (user_id) DO UPDATE
       SET display_name = NULL,
           deleted_at = COALESCE(lenders.deleted_at, now())`,
    [userId, occurredAt],
  );
}
