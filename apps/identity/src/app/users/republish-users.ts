import type { DataSource } from 'typeorm';
import {
  createEnvelope,
  UserEmailVerifiedV1,
  UserProfileUpdatedV1,
  type Locale,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';

/**
 * `nx run identity:republish-users`: re-announces every live account to the
 * outbox, so a service that started after the accounts were made
 * (Bookings) can build its read model: `user.profile_updated` with the
 * current name and language, and `user.email_verified` for verified ones.
 * No email addresses: `user.registered` isn't re-sent, as it means a new
 * account. RabbitMQ only delivers to queues that exist, so run it once that
 * service is up. Safe to repeat: consumers keep the newest name and the
 * first verification.
 *
 * The running Identity's relay publishes the rows.
 */
export async function republishUsers(dataSource: DataSource): Promise<string> {
  return dataSource.transaction(async (tx) => {
    const users: Array<{
      id: string;
      display_name: string;
      locale: Locale;
      email_verified_at: Date | null;
    }> = await tx.query(
      `SELECT id, display_name, locale, email_verified_at FROM users
        WHERE deleted_at IS NULL ORDER BY created_at, id`,
    );
    let verified = 0;
    for (const user of users) {
      await addToOutbox(
        tx,
        createEnvelope(UserProfileUpdatedV1, {
          userId: user.id,
          displayName: user.display_name,
          locale: user.locale,
        }),
      );
      if (user.email_verified_at) {
        verified++;
        await addToOutbox(
          tx,
          createEnvelope(UserEmailVerifiedV1, { userId: user.id }),
        );
      }
    }
    return `${users.length} account(s) (${verified} verified) written to the outbox`;
  });
}
