import type { EntityManager } from 'typeorm';
import { UserEmailVerifiedV1, createEnvelope } from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';

/**
 * Records that the user proved they own their email and, the first time
 * only, emits `user.email_verified` in the same transaction.
 */
export async function markEmailVerified(
  tx: EntityManager,
  userId: string,
  correlationId: string,
): Promise<void> {
  const changed: unknown[] = await tx.query(
    `UPDATE users SET email_verified_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL AND email_verified_at IS NULL
      RETURNING id`,
    [userId],
  );
  if (changed.length === 0) return;
  await addToOutbox(
    tx,
    createEnvelope(UserEmailVerifiedV1, { userId }, { correlationId }),
  );
}
