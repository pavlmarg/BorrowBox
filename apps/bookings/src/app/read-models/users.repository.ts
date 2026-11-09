import type { EntityManager } from 'typeorm';

/**
 * The `users` read model: names and verified emails, from Identity's
 * events. Events may arrive late or out of order, so:
 * - the newest `occurredAt` wins for the name;
 * - verification is kept from the first event;
 * - deletion is final: later events never bring a deleted user back;
 * - whether they can be paid comes from Payments' events, the newest wins.
 */

export interface UserRow {
  user_id: string;
  display_name: string | null;
  name_updated_at: Date | null;
  email_verified_at: Date | null;
  deleted_at: Date | null;
  /** Payments can pay them (`payment.account_ready`, ADR-0019). */
  payouts_ready: boolean;
  payouts_changed_at: Date | null;
}

/**
 * From `payment.account_ready` (true) or `.account_restricted` (false).
 * An older event never overrides a newer one; ignored once deleted.
 */
export async function savePayoutsReady(
  tx: EntityManager,
  userId: string,
  ready: boolean,
  occurredAt: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO users (user_id, payouts_ready, payouts_changed_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET payouts_ready = EXCLUDED.payouts_ready,
           payouts_changed_at = EXCLUDED.payouts_changed_at
       WHERE users.deleted_at IS NULL
         AND (users.payouts_changed_at IS NULL
              OR users.payouts_changed_at < EXCLUDED.payouts_changed_at)`,
    [userId, ready, occurredAt],
  );
}

/** From `user.registered` or `user.profile_updated`; creates the row if missing. */
export async function saveUserName(
  tx: EntityManager,
  userId: string,
  displayName: string,
  occurredAt: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO users (user_id, display_name, name_updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           name_updated_at = EXCLUDED.name_updated_at
       WHERE users.deleted_at IS NULL
         AND (users.name_updated_at IS NULL
              OR users.name_updated_at < EXCLUDED.name_updated_at)`,
    [userId, displayName, occurredAt],
  );
}

/** From `user.email_verified`. The first one counts; ignored once deleted. */
export async function saveUserVerified(
  tx: EntityManager,
  userId: string,
  occurredAt: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO users (user_id, email_verified_at)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET email_verified_at = EXCLUDED.email_verified_at
       WHERE users.deleted_at IS NULL AND users.email_verified_at IS NULL`,
    [userId, occurredAt],
  );
}

/**
 * From `user.deletion_requested`. Forgets the name and verification, and
 * keeps the id, even for a user Bookings never heard of, so a late event
 * can't add them back.
 */
export async function markUserDeleted(
  tx: EntityManager,
  userId: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO users (user_id, deleted_at)
     VALUES ($1, now())
     ON CONFLICT (user_id) DO UPDATE
       SET display_name = NULL,
           name_updated_at = NULL,
           email_verified_at = NULL,
           payouts_ready = false,
           deleted_at = COALESCE(users.deleted_at, now())`,
    [userId],
  );
}

export async function findUser(
  tx: EntityManager,
  userId: string,
): Promise<UserRow | null> {
  const [row] = await tx.query(`SELECT * FROM users WHERE user_id = $1`, [
    userId,
  ]);
  return row ?? null;
}

/** True if Payments said the lender can be paid (and the account is live). */
export async function canBePaid(
  tx: EntityManager,
  userId: string,
): Promise<boolean> {
  const user = await findUser(tx, userId);
  return Boolean(user?.payouts_ready && !user.deleted_at);
}

/**
 * Serialises, per user, what adds bookings as renter and what erases the
 * account: requests can't slip past the open-request limit or past the
 * account's erasure. Held until the transaction ends.
 */
export async function lockUserBookings(
  tx: EntityManager,
  userId: string,
): Promise<void> {
  // 2001: this lock's namespace among Bookings' advisory locks.
  await tx.query(`SELECT pg_advisory_xact_lock(2001, hashtext($1))`, [userId]);
}
