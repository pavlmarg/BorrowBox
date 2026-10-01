import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '@borrowbox/auth';
import {
  UserDeletionRequestedV1,
  UserRegisteredV1,
  createEnvelope,
  type IdentityDataExport,
  type Locale,
  type OAuthProvider,
  type UserProfile,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { PasswordHasher } from '../auth/password-hasher';
import { DATA_SOURCE } from '../database/database.module';
import { IdentityError } from '../rpc/rpc-errors';
import type { DeleteAccountDto, UpdateProfileDto } from './me.dto';
import { findProfile } from './user-profile';

/** Accounts without a password must have signed in this recently to delete themselves. */
export const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

/** What remains of a deleted account's identifying fields (kept for the row's constraints). */
export const anonymisedEmail = (userId: string) => `deleted+${userId}@invalid`;
export const ANONYMISED_DISPLAY_NAME = 'Deleted user';

const UNAUTHENTICATED = () =>
  new IdentityError('UNAUTHENTICATED', 'Authentication required');

@Injectable()
export class MeService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly hasher: PasswordHasher,
  ) {}

  async get(auth: AuthUser): Promise<UserProfile> {
    await assertLiveSession(this.dataSource.manager, auth);
    const profile = await findProfile(this.dataSource.manager, auth.userId);
    if (!profile) throw UNAUTHENTICATED();
    return profile;
  }

  async update(auth: AuthUser, dto: UpdateProfileDto): Promise<UserProfile> {
    return this.dataSource.transaction(async (tx) => {
      await assertLiveSession(tx, auth);
      await tx.query(
        `UPDATE users
            SET display_name = COALESCE($2, display_name),
                locale       = COALESCE($3, locale),
                updated_at   = now()
          WHERE id = $1 AND deleted_at IS NULL`,
        [auth.userId, dto.displayName ?? null, dto.locale ?? null],
      );
      // Null if the account was deleted meanwhile.
      const profile = await findProfile(tx, auth.userId);
      if (!profile) throw UNAUTHENTICATED();
      return profile;
    });
  }

  /** Everything Identity holds about the user, minus secrets (hashes, tokens). */
  async export(auth: AuthUser): Promise<IdentityDataExport> {
    const db = this.dataSource.manager;
    await assertLiveSession(db, auth);
    const [user]: Array<{
      id: string;
      email: string;
      display_name: string;
      locale: Locale;
      email_verified_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }> = await db.query(
      `SELECT id, email, display_name, locale, email_verified_at, created_at, updated_at
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [auth.userId],
    );
    if (!user) throw UNAUTHENTICATED();

    const identities: Array<{ provider: OAuthProvider; created_at: Date }> =
      await db.query(
        `SELECT provider, created_at FROM oauth_identities
          WHERE user_id = $1 ORDER BY created_at`,
        [auth.userId],
      );
    // One entry per sign-in session (token family), not per rotated token.
    const sessions: Array<{ created_at: Date; expires_at: Date }> =
      await db.query(
        `SELECT min(created_at) AS created_at, max(expires_at) AS expires_at
           FROM refresh_tokens WHERE user_id = $1
          GROUP BY family_id ORDER BY 1`,
        [auth.userId],
      );

    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        locale: user.locale,
        emailVerifiedAt: user.email_verified_at?.toISOString() ?? null,
        createdAt: user.created_at.toISOString(),
        updatedAt: user.updated_at.toISOString(),
      },
      oauthIdentities: identities.map((i) => ({
        provider: i.provider,
        linkedAt: i.created_at.toISOString(),
      })),
      sessions: sessions.map((s) => ({
        createdAt: s.created_at.toISOString(),
        expiresAt: s.expires_at.toISOString(),
      })),
    };
  }

  /**
   * GDPR erasure for Identity's own data, then `user.deletion_requested` for
   * every other service, all in one transaction.
   */
  async delete(
    auth: AuthUser,
    dto: DeleteAccountDto,
    correlationId: string,
  ): Promise<void> {
    await this.reauthenticate(auth, dto);

    await this.dataSource.transaction(async (tx) => {
      const locked: unknown[] = await tx.query(
        `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [auth.userId],
      );
      if (locked.length === 0) throw UNAUTHENTICATED(); // deleted concurrently

      // The row stays (financial/legal records elsewhere may reference the id);
      // everything that identifies the person goes.
      await tx.query(
        `UPDATE users
            SET email = $2, display_name = NULL, password_hash = NULL,
                email_verified_at = NULL, updated_at = now(), deleted_at = now()
          WHERE id = $1`,
        [auth.userId, anonymisedEmail(auth.userId)],
      );
      await tx.query(`DELETE FROM oauth_identities WHERE user_id = $1`, [
        auth.userId,
      ]);
      await tx.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [
        auth.userId,
      ]);
      await redactRegisteredEvents(tx, auth.userId);

      await addToOutbox(
        tx,
        createEnvelope(
          UserDeletionRequestedV1,
          { userId: auth.userId },
          { correlationId },
        ),
      );
    });
  }

  /**
   * Password accounts: the current password. Password-less (OAuth-only)
   * accounts: a sign-in within REAUTH_MAX_AGE_MS. Either way the access
   * token's session must still be live (not logged out or revoked).
   */
  private async reauthenticate(
    auth: AuthUser,
    dto: DeleteAccountDto,
  ): Promise<void> {
    const [row]: Array<{
      password_hash: string | null;
      signed_in_at: Date | null;
      live: boolean | null;
    }> = await this.dataSource.query(
      `SELECT u.password_hash,
              (SELECT min(created_at) FROM refresh_tokens
                WHERE family_id = $2 AND user_id = u.id) AS signed_in_at,
              (SELECT bool_or(revoked_at IS NULL AND rotated_at IS NULL AND expires_at > now())
                 FROM refresh_tokens
                WHERE family_id = $2 AND user_id = u.id) AS live
         FROM users u
        WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [auth.userId, auth.sessionId],
    );
    if (!row || !row.live) throw UNAUTHENTICATED();

    if (row.password_hash !== null) {
      if (dto.password === undefined) {
        throw new IdentityError(
          'REAUTHENTICATION_REQUIRED',
          'Enter your password to delete your account',
        );
      }
      if (!(await this.hasher.verify(row.password_hash, dto.password))) {
        throw new IdentityError('INVALID_CREDENTIALS', 'Wrong password');
      }
      return;
    }

    const signedInAt = row.signed_in_at?.getTime() ?? 0;
    if (Date.now() - signedInAt > REAUTH_MAX_AGE_MS) {
      throw new IdentityError(
        'REAUTHENTICATION_REQUIRED',
        'Sign in again to delete your account',
      );
    }
  }
}

/**
 * The access token's sign-in session (`sid` = refresh-token family) must
 * still be live, so a token stops working at logout, reuse detection or the
 * Google auto-link revocation instead of lasting out its 15 minutes.
 */
async function assertLiveSession(
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
  if (!live) throw UNAUTHENTICATED();
}

/**
 * Published outbox rows are kept for a week (see @borrowbox/outbox), so
 * the `user.registered` envelope would otherwise keep the email and name
 * after erasure until then. Replace them with the anonymised values; the contract shape stays valid.
 */
async function redactRegisteredEvents(
  tx: EntityManager,
  userId: string,
): Promise<void> {
  await tx.query(
    `UPDATE outbox
        SET envelope = jsonb_set(
              jsonb_set(envelope, '{payload,email}', to_jsonb($2::text)),
              '{payload,displayName}', to_jsonb($3::text))
      WHERE routing_key = $4
        AND envelope->'payload'->>'userId' = $1`,
    [
      userId,
      anonymisedEmail(userId),
      ANONYMISED_DISPLAY_NAME,
      UserRegisteredV1.routingKey,
    ],
  );
}
