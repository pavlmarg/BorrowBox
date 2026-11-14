import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import {
  createEnvelope,
  UserEmailVerifiedV1,
  UserProfileUpdatedV1,
  UserRegisteredV1,
  type Locale,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { profilePhotoUrls } from '../photos/photos.repository';

interface LiveUser {
  id: string;
  email: string;
  display_name: string;
  locale: Locale;
  email_verified_at: Date | null;
  photo_key: string | null;
  bio: string | null;
}

/**
 * `nx run identity:republish-users`: re-announces every live account to the
 * outbox, so a service that started after the accounts were made
 * (Bookings) can build its read model: `user.profile_updated` with the
 * current name, language and photo, and `user.email_verified` for verified
 * ones.
 * No email addresses. RabbitMQ only delivers to queues that exist, so run
 * it once that service is up. Safe to repeat: consumers keep the newest name
 * and the first verification.
 *
 * The running Identity's relay publishes the rows.
 */
export function republishUsers(
  dataSource: DataSource,
  config: ConfigService,
): Promise<string> {
  return republish(dataSource, photosBaseUrl(config), false);
}

/**
 * `nx run identity:republish-registered`: the same, but re-sends
 * `user.registered`, which carries the email address, instead of
 * `user.profile_updated`. For services that need to reach people
 * (Notifications). No consumer treats `user.registered` as news (no welcome
 * email), so re-sending it is safe.
 */
export function republishRegistered(
  dataSource: DataSource,
  config: ConfigService,
): Promise<string> {
  return republish(dataSource, photosBaseUrl(config), true);
}

function photosBaseUrl(config: ConfigService): string {
  return config.getOrThrow<string>('PHOTOS_BASE_URL');
}

async function republish(
  dataSource: DataSource,
  baseUrl: string,
  withEmail: boolean,
): Promise<string> {
  return dataSource.transaction(async (tx) => {
    const users: LiveUser[] = await tx.query(
      `SELECT id, email, display_name, locale, email_verified_at, photo_key, bio
         FROM users WHERE deleted_at IS NULL ORDER BY created_at, id`,
    );
    let verified = 0;
    for (const user of users) {
      const profile = {
        userId: user.id,
        displayName: user.display_name,
        locale: user.locale,
      };
      await addToOutbox(
        tx,
        withEmail
          ? createEnvelope(UserRegisteredV1, { ...profile, email: user.email })
          : createEnvelope(UserProfileUpdatedV1, {
              ...profile,
              photo: user.photo_key
                ? profilePhotoUrls(baseUrl, user.photo_key)
                : null,
              bio: user.bio,
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
