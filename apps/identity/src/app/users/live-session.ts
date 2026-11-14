import type { EntityManager } from 'typeorm';
import type { AuthUser } from '@borrowbox/auth';
import { IdentityError } from '../rpc/rpc-errors';

/**
 * The access token's sign-in session (`sid` = refresh-token family) must
 * still be live, so a token stops working at logout, reuse detection or the
 * Google auto-link revocation instead of lasting out its 15 minutes.
 */
export async function assertLiveSession(
  db: EntityManager,
  auth: AuthUser,
): Promise<void> {
  const [{ live }]: Array<{ live: boolean }> = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM refresh_tokens
        WHERE family_id = $1 AND user_id = $2
          AND revoked_at IS NULL AND rotated_at IS NULL AND expires_at > now()
     ) AS live`,
    [auth.sessionId, auth.userId],
  );
  if (!live) {
    throw new IdentityError('UNAUTHENTICATED', 'Authentication required');
  }
}
