import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  UserRegisteredV1,
  createEnvelope,
  type AuthSession,
  type Locale,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { SessionService } from '../auth/session.service';
import { DATA_SOURCE } from '../database/database.module';
import { IdentityError } from '../rpc/rpc-errors';
import {
  GoogleOidcClient,
  type GoogleCodeExchange,
  type GoogleIdentity,
} from './google-oidc.client';

const PROVIDER = 'google';
const DEFAULT_LOCALE: Locale = 'el';

/** Google's `name`, else the email's local part; trimmed and cut to the display-name limit. */
export function displayNameFor(identity: GoogleIdentity): string {
  const fromName = identity.name?.trim();
  const base = fromName || identity.email.split('@')[0] || 'User';
  return [...base].slice(0, DISPLAY_NAME_MAX_LENGTH).join('').trim() || 'User';
}

/**
 * Google sign-in with auto-linking by verified email (Phase 1, step 8):
 * 1. email not verified by Google → OAUTH_EMAIL_NOT_VERIFIED
 * 2. (google, sub) already linked → sign in
 * 3. an account has this email → link; if its email was never verified,
 *    Google's proof is the first real proof of ownership, so clear the
 *    password and revoke every session (defeats account pre-hijacking)
 * 4. otherwise → new verified account + user.registered
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly google: GoogleOidcClient,
    private readonly sessions: SessionService,
  ) {}

  async signIn(
    exchange: GoogleCodeExchange,
    correlationId: string,
  ): Promise<AuthSession> {
    const identity = await this.google.exchange(exchange);
    if (!identity.emailVerified) {
      throw new IdentityError(
        'OAUTH_EMAIL_NOT_VERIFIED',
        'Your Google account email is not verified',
      );
    }
    if ([...identity.email].length > EMAIL_MAX_LENGTH) {
      throw new IdentityError('OAUTH_EXCHANGE_FAILED', 'Email is too long');
    }

    // Two first-time sign-ins racing can both miss the lookup; the loser hits
    // a unique constraint and simply retries, now finding the winner's rows.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.dataSource.transaction((tx) =>
          this.signInWith(tx, identity, correlationId),
        );
      } catch (err) {
        if (attempt < 2 && isUniqueViolation(err)) continue;
        throw err;
      }
    }
  }

  private async signInWith(
    tx: EntityManager,
    identity: GoogleIdentity,
    correlationId: string,
  ): Promise<AuthSession> {
    const [linked]: Array<{ user_id: string }> = await tx.query(
      `SELECT o.user_id FROM oauth_identities o
         JOIN users u ON u.id = o.user_id AND u.deleted_at IS NULL
        WHERE o.provider = $1 AND o.subject = $2`,
      [PROVIDER, identity.subject],
    );
    if (linked) return this.sessions.start(tx, linked.user_id);

    const [existing]: Array<{
      id: string;
      email_verified_at: Date | null;
      has_google: boolean;
    }> = await tx.query(
      `SELECT u.id, u.email_verified_at,
              EXISTS (SELECT 1 FROM oauth_identities o
                       WHERE o.user_id = u.id AND o.provider = $2) AS has_google
         FROM users u
        WHERE lower(u.email) = lower($1) AND u.deleted_at IS NULL
        FOR UPDATE OF u`,
      [identity.email, PROVIDER],
    );

    if (existing) {
      // The account already trusts a different Google account (e.g. a
      // recycled address). Don't attach a second one by email alone.
      if (existing.has_google) {
        throw new IdentityError(
          'OAUTH_EXCHANGE_FAILED',
          'This email is linked to a different Google account',
        );
      }
      await tx.query(
        `INSERT INTO oauth_identities (provider, subject, user_id) VALUES ($1, $2, $3)`,
        [PROVIDER, identity.subject, existing.id],
      );
      if (existing.email_verified_at === null) {
        await tx.query(
          `UPDATE users SET password_hash = NULL, email_verified_at = now(), updated_at = now()
            WHERE id = $1`,
          [existing.id],
        );
        await tx.query(
          `UPDATE refresh_tokens SET revoked_at = now()
            WHERE user_id = $1 AND revoked_at IS NULL`,
          [existing.id],
        );
        this.logger.log(
          `Linked Google to unverified account ${existing.id}; password cleared and sessions revoked`,
        );
      }
      return this.sessions.start(tx, existing.id);
    }

    const displayName = displayNameFor(identity);
    const [user]: Array<{ id: string }> = await tx.query(
      `INSERT INTO users (email, password_hash, email_verified_at, display_name, locale)
       VALUES ($1, NULL, now(), $2, $3) RETURNING id`,
      [identity.email, displayName, DEFAULT_LOCALE],
    );
    await tx.query(
      `INSERT INTO oauth_identities (provider, subject, user_id) VALUES ($1, $2, $3)`,
      [PROVIDER, identity.subject, user.id],
    );
    await addToOutbox(
      tx,
      createEnvelope(
        UserRegisteredV1,
        {
          userId: user.id,
          email: identity.email,
          displayName,
          locale: DEFAULT_LOCALE,
        },
        { correlationId },
      ),
    );
    return this.sessions.start(tx, user.id);
  }
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } };
  return (e?.driverError?.code ?? e?.code) === '23505';
}
