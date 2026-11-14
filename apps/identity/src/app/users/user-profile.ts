import type { EntityManager } from 'typeorm';
import {
  createEnvelope,
  UserProfileUpdatedV1,
  type Locale,
  type OAuthProvider,
  type ProfilePhotoUploadStatus,
  type PublicProfile,
  type UserProfile,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { profilePhotoUrls } from '../photos/photos.repository';

interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  locale: Locale;
  photo_key: string | null;
  bio: string | null;
  photo_upload: ProfilePhotoUploadStatus | null;
  has_password: boolean;
  email_verified: boolean;
  created_at: Date;
  providers: OAuthProvider[];
}

/** Like {@link findProfile}, for callers that just created or verified the user. */
export async function loadProfile(
  db: EntityManager,
  userId: string,
  photosBaseUrl: string,
): Promise<UserProfile> {
  const profile = await findProfile(db, userId, photosBaseUrl);
  if (!profile) throw new Error('User not found');
  return profile;
}

/** The public view of an account, or null if it doesn't exist or was deleted. Never includes the password hash. */
export async function findProfile(
  db: EntityManager,
  userId: string,
  photosBaseUrl: string,
): Promise<UserProfile | null> {
  const rows: ProfileRow[] = await db.query(
    `SELECT u.id, u.email, u.display_name, u.locale, u.created_at, u.photo_key, u.bio,
            (SELECT p.status FROM user_photos p WHERE p.user_id = u.id) AS photo_upload,
            u.password_hash IS NOT NULL      AS has_password,
            u.email_verified_at IS NOT NULL  AS email_verified,
            COALESCE(array_agg(o.provider ORDER BY o.provider)
                     FILTER (WHERE o.provider IS NOT NULL), '{}') AS providers
       FROM users u
       LEFT JOIN oauth_identities o ON o.user_id = u.id
      WHERE u.id = $1 AND u.deleted_at IS NULL
      GROUP BY u.id`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    locale: row.locale,
    emailVerified: row.email_verified,
    hasPassword: row.has_password,
    providers: row.providers,
    photo: row.photo_key
      ? profilePhotoUrls(photosBaseUrl, row.photo_key)
      : null,
    photoUpload: row.photo_upload,
    bio: row.bio,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * What anyone may see of a live account (ADR-0025), or null if it doesn't
 * exist or was deleted. Never the email, language or sign-in methods.
 */
export async function findPublicProfile(
  db: EntityManager,
  userId: string,
  photosBaseUrl: string,
): Promise<PublicProfile | null> {
  const [row]: Array<{
    id: string;
    display_name: string;
    photo_key: string | null;
    bio: string | null;
    created_at: Date;
  }> = await db.query(
    `SELECT id, display_name, photo_key, bio, created_at FROM users
      WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    photo: row.photo_key
      ? profilePhotoUrls(photosBaseUrl, row.photo_key)
      : null,
    bio: row.bio,
    memberSince: row.created_at.toISOString(),
  };
}

/**
 * Writes `user.profile_updated` with all the live user's current public
 * values (name, language, photo, bio) to the outbox, in the caller's transaction.
 * Call with the user's row locked, so events follow the order of the
 * changes (consumers keep the newest).
 */
export async function announceProfile(
  tx: EntityManager,
  userId: string,
  photosBaseUrl: string,
  correlationId?: string,
): Promise<void> {
  const [user]: Array<{
    display_name: string;
    locale: Locale;
    photo_key: string | null;
    bio: string | null;
  }> = await tx.query(
    `SELECT display_name, locale, photo_key, bio FROM users
      WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (!user) return;
  await addToOutbox(
    tx,
    createEnvelope(
      UserProfileUpdatedV1,
      {
        userId,
        displayName: user.display_name,
        locale: user.locale,
        photo: user.photo_key
          ? profilePhotoUrls(photosBaseUrl, user.photo_key)
          : null,
        bio: user.bio,
      },
      correlationId ? { correlationId } : {},
    ),
  );
}
