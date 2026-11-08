import type { EntityManager } from 'typeorm';
import type { AccountFlags } from '../stripe/stripe-api';

export interface AccountRow {
  id: string;
  user_id: string;
  stripe_account_id: string | null;
  details_submitted: boolean;
  transfers_active: boolean;
  payouts_enabled: boolean;
  disabled: boolean;
  ready: boolean;
  created_at: Date;
  synced_at: Date | null;
  deleted_at: Date | null;
  stripe_deleted_at: Date | null;
  deletion_attempts: number;
}

/** The row's Stripe flags; all false until Stripe first tells Payments otherwise. */
export function flagsOf(row: AccountRow): AccountFlags {
  return {
    detailsSubmitted: row.details_submitted,
    transfersActive: row.transfers_active,
    payoutsEnabled: row.payouts_enabled,
    disabled: row.disabled,
  };
}

/**
 * Serialises, per user, onboarding and account erasure, so an erasure can't
 * slip between onboarding's checks and its writes. Held until the
 * transaction ends.
 */
export async function lockUser(
  tx: EntityManager,
  userId: string,
): Promise<void> {
  // 5001: this lock's namespace among Payments' advisory locks.
  await tx.query(`SELECT pg_advisory_xact_lock(5001, hashtext($1))`, [userId]);
}

export async function findAccountByUser(
  tx: EntityManager,
  userId: string,
): Promise<AccountRow | null> {
  const [row] = await tx.query(
    `SELECT * FROM connected_accounts WHERE user_id = $1`,
    [userId],
  );
  return row ?? null;
}

/** The row of a Stripe account, without locking it. */
export async function findAccountByStripeId(
  tx: EntityManager,
  stripeAccountId: string,
): Promise<AccountRow | null> {
  const [row] = await tx.query(
    `SELECT * FROM connected_accounts WHERE stripe_account_id = $1`,
    [stripeAccountId],
  );
  return row ?? null;
}

/** Locks the row until the transaction ends (webhook processing). */
export async function lockAccountByStripeId(
  tx: EntityManager,
  stripeAccountId: string,
): Promise<AccountRow | null> {
  const [row] = await tx.query(
    `SELECT * FROM connected_accounts WHERE stripe_account_id = $1 FOR UPDATE`,
    [stripeAccountId],
  );
  return row ?? null;
}

/** Creates the lender's row once; a second call keeps the first. */
export async function insertAccount(
  tx: EntityManager,
  id: string,
  userId: string,
): Promise<AccountRow> {
  await tx.query(
    `INSERT INTO connected_accounts (id, user_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [id, userId],
  );
  const row = await findAccountByUser(tx, userId);
  if (!row) throw new Error('connected account row missing after insert');
  return row;
}

/** Records Stripe's account id; the first one saved wins. */
export async function setStripeAccountId(
  tx: EntityManager,
  id: string,
  stripeAccountId: string,
): Promise<void> {
  await tx.query(
    `UPDATE connected_accounts SET stripe_account_id = $2
      WHERE id = $1 AND stripe_account_id IS NULL`,
    [id, stripeAccountId],
  );
}

/** Stores the flags just fetched from Stripe, and what was announced. */
export async function saveFlags(
  tx: EntityManager,
  id: string,
  flags: AccountFlags,
  ready: boolean,
): Promise<void> {
  await tx.query(
    `UPDATE connected_accounts
        SET details_submitted = $2, transfers_active = $3,
            payouts_enabled = $4, disabled = $5, ready = $6, synced_at = now()
      WHERE id = $1`,
    [
      id,
      flags.detailsSubmitted,
      flags.transfersActive,
      flags.payoutsEnabled,
      flags.disabled,
      ready,
    ],
  );
}

/**
 * From `user.deletion_requested` (A7): the account is closed for good, and
 * its Stripe account queued for deletion. No Stripe account yet means
 * nothing to delete at Stripe.
 */
export async function markAccountDeleted(
  tx: EntityManager,
  userId: string,
): Promise<void> {
  await tx.query(
    `UPDATE connected_accounts
        SET deleted_at = COALESCE(deleted_at, now()),
            ready = false,
            next_deletion_at = COALESCE(next_deletion_at, now())
      WHERE user_id = $1`,
    [userId],
  );
}

export interface DeletionJob {
  id: string;
  stripe_account_id: string | null;
  deletion_attempts: number;
  deleted_at: Date;
}

/**
 * Claims up to `limit` Stripe accounts due for deletion by pushing their
 * next attempt `leaseMs` ahead, so other workers skip them; one that crashes
 * leaves them to be retried after the lease. An account whose Stripe id
 * isn't saved yet waits: onboarding may still be saving it.
 */
export async function claimDueDeletions(
  tx: EntityManager,
  limit: number,
  leaseMs: number,
): Promise<DeletionJob[]> {
  // TypeORM returns [rows, rowCount] for UPDATE … RETURNING.
  const [rows] = await tx.query(
    `UPDATE connected_accounts
        SET next_deletion_at = now() + make_interval(secs => $2::float8 / 1000)
      WHERE id IN (SELECT id FROM connected_accounts
                    WHERE deleted_at IS NOT NULL AND stripe_deleted_at IS NULL
                      AND next_deletion_at <= now()
                    ORDER BY next_deletion_at
                    LIMIT $1::int
                    FOR UPDATE SKIP LOCKED)
      RETURNING id, stripe_account_id, deletion_attempts, deleted_at`,
    [limit, leaseMs],
  );
  return rows;
}

export async function markStripeDeleted(
  tx: EntityManager,
  id: string,
): Promise<void> {
  await tx.query(
    `UPDATE connected_accounts SET stripe_deleted_at = now() WHERE id = $1`,
    [id],
  );
}

/** Tries the Stripe deletion again after `delayMs`; counts a failed attempt when `failed`. */
export async function retryDeletionLater(
  tx: EntityManager,
  id: string,
  delayMs: number,
  failed: boolean,
): Promise<void> {
  await tx.query(
    `UPDATE connected_accounts
        SET next_deletion_at = now() + make_interval(secs => $2::float8 / 1000),
            deletion_attempts = deletion_attempts + CASE WHEN $3 THEN 1 ELSE 0 END
      WHERE id = $1`,
    [id, delayMs, failed],
  );
}
