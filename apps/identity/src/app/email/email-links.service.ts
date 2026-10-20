import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { isWellFormedEmailToken } from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { PasswordHasher } from '../auth/password-hasher';
import { IdentityError } from '../rpc/rpc-errors';
import { AccountMailer, findRecipient } from './account-mailer';
import type {
  RequestPasswordResetDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './email-links.dto';
import { markEmailVerified } from './email-verified';
import { consumeEmailToken, issueEmailToken } from './email-tokens';

/** The email-link flows that need no sign-in: verify an email, reset a password. */
@Injectable()
export class EmailLinksService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly hasher: PasswordHasher,
    private readonly mailer: AccountMailer,
  ) {}

  async verifyEmail(dto: VerifyEmailDto, correlationId: string): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const userId = await consumeEmailToken(tx, 'VERIFY_EMAIL', dto.token);
      await markEmailVerified(tx, userId, correlationId);
    });
  }

  /**
   * Answers at once and does the work in the background, so neither the
   * answer nor its timing shows whether the email has an account. Unknown
   * emails and requests within the cooldown send nothing.
   */
  requestPasswordReset(dto: RequestPasswordResetDto): Promise<void> {
    this.mailer.later('a password-reset email', async () => {
      const found = await this.dataSource.transaction(async (tx) => {
        const [user]: Array<{ id: string }> = await tx.query(
          `SELECT id FROM users
            WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
          [dto.email],
        );
        if (!user) return null;
        const token = await issueEmailToken(tx, user.id, 'RESET_PASSWORD');
        const to = await findRecipient(tx, user.id);
        return token && to ? { token, to } : null;
      });
      if (found) await this.mailer.sendPasswordReset(found.to, found.token);
    });
    return Promise.resolve();
  }

  /**
   * Sets the new password, signs out every session and, since the link
   * proves the inbox is theirs, marks the email verified. Accounts without
   * a password (Google only) get one this way. A notice follows by email.
   */
  async resetPassword(
    dto: ResetPasswordDto,
    correlationId: string,
  ): Promise<void> {
    // Hashing is deliberately slow: skip it for tokens that can't be valid.
    if (!isWellFormedEmailToken(dto.token)) {
      throw new IdentityError('TOKEN_INVALID', 'This link is no longer valid');
    }
    const passwordHash = await this.hasher.hash(dto.newPassword);
    const to = await this.dataSource.transaction(async (tx) => {
      const userId = await consumeEmailToken(tx, 'RESET_PASSWORD', dto.token);
      await tx.query(
        `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
        [userId, passwordHash],
      );
      await tx.query(
        `UPDATE refresh_tokens SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      await markEmailVerified(tx, userId, correlationId);
      return findRecipient(tx, userId);
    });
    if (to) {
      this.mailer.later('a password-changed notice', () =>
        this.mailer.sendPasswordChanged(to),
      );
    }
  }
}
