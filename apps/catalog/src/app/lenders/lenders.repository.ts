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

/**
 * Serialises, per lender, everything that adds, places or erases items: two
 * creates can't both slip under the item limit, a create can't run
 * alongside the account's erasure (and survive it), and two items placed at
 * once can't draw two offsets for one place (ADR-0011). Held until the
 * transaction ends. Different lenders never wait for each other (unless
 * their ids hash alike, which only costs a brief wait).
 */
export async function lockLenderItems(
  tx: EntityManager,
  lenderId: string,
): Promise<void> {
  // 1001: this lock's namespace among Catalog's advisory locks.
  await tx.query(`SELECT pg_advisory_xact_lock(1001, hashtext($1))`, [
    lenderId,
  ]);
}

/**
 * True once Catalog has processed the account's deletion. Access tokens stay
 * valid for up to 15 minutes, so write commands check this too.
 */
export async function isLenderDeleted(
  tx: EntityManager,
  lenderId: string,
): Promise<boolean> {
  const rows: unknown[] = await tx.query(
    `SELECT 1 FROM lenders WHERE user_id = $1 AND deleted_at IS NOT NULL`,
    [lenderId],
  );
  return rows.length > 0;
}

/** The live lender's stored name, for their data export; null if unknown or deleted. */
export async function findLenderProfile(
  tx: EntityManager,
  lenderId: string,
): Promise<{ displayName: string; updatedAt: Date } | null> {
  const [row] = await tx.query(
    `SELECT display_name, name_updated_at FROM lenders
      WHERE user_id = $1 AND deleted_at IS NULL`,
    [lenderId],
  );
  return row
    ? { displayName: row.display_name, updatedAt: row.name_updated_at }
    : null;
}
