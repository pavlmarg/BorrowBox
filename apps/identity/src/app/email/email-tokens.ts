import { createHash, randomBytes } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import {
  EMAIL_LINK_COOLDOWN_MS,
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  isWellFormedEmailToken,
} from '@borrowbox/contracts';
import { IdentityError } from '../rpc/rpc-errors';

/**
 * One-time tokens for email links (ADR-0016). The raw token exists only in
 * memory and in the email; the database keeps its SHA-256 hash. Never log,
 * publish or return one.
 */
export type EmailTokenKind = 'VERIFY_EMAIL' | 'RESET_PASSWORD';

export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenKind, number> = {
  VERIFY_EMAIL: EMAIL_VERIFICATION_TTL_MS,
  RESET_PASSWORD: PASSWORD_RESET_TTL_MS,
};

const TOKEN_INVALID = () =>
  new IdentityError('TOKEN_INVALID', 'This link is no longer valid');
const TOKEN_EXPIRED = () =>
  new IdentityError('TOKEN_EXPIRED', 'This link has expired');

export function hashEmailToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * A new token of `kind` for the user, replacing their older ones of that
 * kind, or null if one was issued within `EMAIL_LINK_COOLDOWN_MS` (the caller
 * then sends nothing). Locks the user row, so concurrent requests can't both
 * pass the cooldown. Run it inside the caller's transaction.
 */
export async function issueEmailToken(
  tx: EntityManager,
  userId: string,
  kind: EmailTokenKind,
  now = new Date(),
): Promise<string | null> {
  await tx.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [userId]);
  const [{ recent }]: Array<{ recent: boolean }> = await tx.query(
    `SELECT EXISTS (
       SELECT 1 FROM email_tokens
        WHERE user_id = $1 AND kind = $2 AND created_at > $3
     ) AS recent`,
    [userId, kind, new Date(now.getTime() - EMAIL_LINK_COOLDOWN_MS)],
  );
  if (recent) return null;

  await tx.query(`DELETE FROM email_tokens WHERE user_id = $1 AND kind = $2`, [
    userId,
    kind,
  ]);
  const token = randomBytes(32).toString('base64url');
  await tx.query(
    `INSERT INTO email_tokens (user_id, kind, token_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId,
      kind,
      hashEmailToken(token),
      now,
      new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[kind]),
    ],
  );
  return token;
}

/**
 * Marks the token used and returns its account's id. Unknown, used, replaced
 * or wrong-kind tokens, and tokens of deleted accounts, are `TOKEN_INVALID`;
 * tokens past their lifetime are `TOKEN_EXPIRED`. The row lock makes two
 * concurrent uses of one link succeed at most once.
 */
export async function consumeEmailToken(
  tx: EntityManager,
  kind: EmailTokenKind,
  token: string,
  now = new Date(),
): Promise<string> {
  if (!isWellFormedEmailToken(token)) throw TOKEN_INVALID();
  const [row]: Array<{
    id: string;
    user_id: string;
    expires_at: Date;
    used_at: Date | null;
  }> = await tx.query(
    `SELECT t.id, t.user_id, t.expires_at, t.used_at
       FROM email_tokens t
       JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL
      WHERE t.token_hash = $1 AND t.kind = $2
      FOR UPDATE OF t`,
    [hashEmailToken(token), kind],
  );
  if (!row || row.used_at !== null) throw TOKEN_INVALID();
  if (row.expires_at.getTime() <= now.getTime()) throw TOKEN_EXPIRED();

  await tx.query(`UPDATE email_tokens SET used_at = $2 WHERE id = $1`, [
    row.id,
    now,
  ]);
  return row.user_id;
}
