import type { EntityManager } from 'typeorm';
import type { Locale, OAuthProvider, UserProfile } from '@borrowbox/contracts';

interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  locale: Locale;
  has_password: boolean;
  email_verified: boolean;
  created_at: Date;
  providers: OAuthProvider[];
}

/** Like {@link findProfile}, for callers that just created or verified the user. */
export async function loadProfile(
  db: EntityManager,
  userId: string,
): Promise<UserProfile> {
  const profile = await findProfile(db, userId);
  if (!profile) throw new Error('User not found');
  return profile;
}

/** The public view of an account, or null if it doesn't exist or was deleted. Never includes the password hash. */
export async function findProfile(
  db: EntityManager,
  userId: string,
): Promise<UserProfile | null> {
  const rows: ProfileRow[] = await db.query(
    `SELECT u.id, u.email, u.display_name, u.locale, u.created_at,
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
    createdAt: row.created_at.toISOString(),
  };
}
