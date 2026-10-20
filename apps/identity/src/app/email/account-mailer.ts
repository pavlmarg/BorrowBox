import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import type { Locale } from '@borrowbox/contracts';
import type { Mailer } from '@borrowbox/mailer';
import type { IdentityConfig } from '../config';
import {
  passwordChangedMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from './templates';

export const MAILER = Symbol('MAILER');

/** Who an email goes to: read inside the transaction, sent after it commits. */
export interface Recipient {
  email: string;
  name: string;
  locale: Locale;
}

/** The live account's email, name and language, or null if it's gone. */
export async function findRecipient(
  db: EntityManager,
  userId: string,
): Promise<Recipient | null> {
  const [row]: Array<{ email: string; display_name: string; locale: Locale }> =
    await db.query(
      `SELECT email, display_name, locale FROM users
        WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
  return row
    ? { email: row.email, name: row.display_name, locale: row.locale }
    : null;
}

/**
 * Identity's account-security emails (ADR-0016). An email can't be part of
 * a database transaction, so callers commit first and then call `later`:
 * the email goes out in the background and a failure is only logged (the
 * user can ask again). Links carry the token in the fragment (`#t=`), so it
 * never reaches a server's access log or a `Referer` header.
 */
@Injectable()
export class AccountMailer implements OnApplicationShutdown {
  private readonly logger = new Logger('AccountEmails');
  private readonly webBaseUrl: string;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    @Inject(MAILER) private readonly mailer: Mailer,
    config: ConfigService<IdentityConfig, true>,
  ) {
    this.webBaseUrl = config.get('WEB_BASE_URL', { infer: true });
  }

  /** Runs `task` in the background; tracked so shutdown waits for it. */
  later(what: string, task: () => Promise<void>): void {
    const run = task()
      .catch((err: unknown) =>
        // Never the recipient, body or token: just what failed and why.
        this.logger.error(
          `Couldn't send ${what}: ${err instanceof Error ? err.message : 'unknown error'}`,
        ),
      )
      .finally(() => this.pending.delete(run));
    this.pending.add(run);
  }

  /** Resolves once every background email so far has been sent or has failed. */
  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.settled();
    this.mailer.close();
  }

  sendVerification(to: Recipient, token: string): Promise<void> {
    const url = `${this.webBaseUrl}/auth/verify-email#t=${token}`;
    return this.mailer.send({
      to: to.email,
      ...verifyEmailMessage(to.locale, to.name, url),
    });
  }

  sendPasswordReset(to: Recipient, token: string): Promise<void> {
    const url = `${this.webBaseUrl}/auth/reset-password#t=${token}`;
    return this.mailer.send({
      to: to.email,
      ...resetPasswordMessage(to.locale, to.name, url),
    });
  }

  sendPasswordChanged(to: Recipient): Promise<void> {
    const url = `${this.webBaseUrl}/auth/forgot-password`;
    return this.mailer.send({
      to: to.email,
      ...passwordChangedMessage(to.locale, to.name, url),
    });
  }
}
