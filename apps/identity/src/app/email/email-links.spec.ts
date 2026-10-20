import {
  IdentityRpc,
  type AuthSession,
  type Locale,
  type RpcErrorBody,
} from '@borrowbox/contracts';
import {
  startMailpit,
  startPostgres,
  startRabbitMq,
  type CaughtEmail,
  type TestMailpit,
  type TestPostgres,
  type TestRabbitMq,
} from '@borrowbox/testing';
import {
  startIdentity,
  type IdentityHarness,
} from '../../testing/identity-harness';
import { AccountMailer } from './account-mailer';
import { hashEmailToken } from './email-tokens';

/** Email verification, password reset and change, with real email (Mailpit). */
describe('Identity email links (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let mailpit: TestMailpit;
  let identity: IdentityHarness;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    [pg, rabbit, mailpit] = await Promise.all([
      startPostgres(),
      startRabbitMq(),
      startMailpit(),
    ]);
    identity = await startIdentity({
      databaseUrl: pg.urlFor('identity'),
      rabbitmqUrl: rabbit.url,
      env: {
        SMTP_HOST: mailpit.smtpHost,
        SMTP_PORT: String(mailpit.smtpPort),
        WEB_BASE_URL: 'https://borrowbox.test',
      },
    });
  });

  afterAll(async () => {
    await identity?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop(), mailpit?.stop()]);
  });

  const PASSWORD = 'correct horse 42';
  const NEW_PASSWORD = 'battery staple 7';
  let n = 0;
  const signUp = (locale?: Locale): Promise<AuthSession> =>
    identity.send(
      IdentityRpc.register,
      {
        email: `links${++n}@example.com`,
        password: PASSWORD,
        displayName: `Links ${n}`,
        locale,
      },
      { correlationId: `signup-${n}` },
    );
  const as = (s: AuthSession, correlationId?: string) => ({
    accessToken: s.accessToken,
    correlationId,
  });
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => {
        throw new Error('expected the call to fail');
      },
      (err: RpcErrorBody) => err,
    );
  /** Waits for every email Identity is still sending in the background. */
  const settled = () => identity.app.get(AccountMailer).settled();
  const tokenIn = (email: CaughtEmail, path: string): string => {
    const match = email.text.match(
      new RegExp(`https://borrowbox\\.test${path}#t=([A-Za-z0-9_-]{43})`),
    );
    if (!match) throw new Error(`no ${path} link in the email`);
    return match[1];
  };
  const verifiedEvents = (userId: string) =>
    identity.dataSource.query(
      `SELECT envelope FROM outbox
        WHERE routing_key = 'user.email_verified.v1'
          AND envelope->'payload'->>'userId' = $1`,
      [userId],
    );
  /** Moves the user's links back in time, past the cooldown (and optionally their lifetime). */
  const age = (userId: string, opts: { expire?: boolean } = {}) =>
    identity.dataSource.query(
      `UPDATE email_tokens
          SET created_at = created_at - interval '2 minutes',
              expires_at = CASE WHEN $2 THEN now() - interval '1 second' ELSE expires_at END
        WHERE user_id = $1`,
      [userId, opts.expire === true],
    );

  describe('email verification', () => {
    it('emails a link on sign-up that verifies the email once', async () => {
      const s = await signUp();
      const [email] = await mailpit.waitForEmails(s.user.email);
      expect(email.subject).toBe('Επιβεβαίωσε τη διεύθυνση email σου');
      const token = tokenIn(email, '/auth/verify-email');

      // Only the hash is stored.
      const [row] = await identity.dataSource.query(
        `SELECT token_hash, extract(epoch FROM expires_at - created_at)::int AS ttl
           FROM email_tokens
          WHERE user_id = $1 AND kind = 'VERIFY_EMAIL'`,
        [s.user.id],
      );
      expect(row.token_hash).toEqual(hashEmailToken(token));
      expect(row.ttl).toBe(24 * 60 * 60);

      await identity.send(
        IdentityRpc.verifyEmail,
        { token },
        { correlationId: 'verify-1' },
      );
      const me = await identity.send(IdentityRpc.getMe, {}, as(s));
      expect(me.emailVerified).toBe(true);

      const events = await verifiedEvents(s.user.id);
      expect(events).toHaveLength(1);
      expect(events[0].envelope).toMatchObject({
        type: 'user.email_verified',
        version: 1,
        correlationId: 'verify-1',
        payload: { userId: s.user.id },
      });

      const again = await failure(
        identity.send(IdentityRpc.verifyEmail, { token }),
      );
      expect(again.code).toBe('TOKEN_INVALID');
      expect(await verifiedEvents(s.user.id)).toHaveLength(1);
    });

    it('writes in the account’s language', async () => {
      const s = await signUp('en');
      const [email] = await mailpit.waitForEmails(s.user.email);
      expect(email.subject).toBe('Confirm your email address');
      expect(email.text).toContain(`Hi ${s.user.displayName},`);
    });

    it('resends after the cooldown only, and the new link replaces the old one', async () => {
      const s = await signUp();
      const [first] = await mailpit.waitForEmails(s.user.email);
      const oldToken = tokenIn(first, '/auth/verify-email');

      await identity.send(IdentityRpc.sendVerificationEmail, {}, as(s));
      await settled();
      expect(await mailpit.emailsTo(s.user.email)).toHaveLength(1);

      await age(s.user.id);
      await identity.send(IdentityRpc.sendVerificationEmail, {}, as(s));
      const emails = await mailpit.waitForEmails(s.user.email, 2);
      const newToken = tokenIn(emails[1], '/auth/verify-email');

      expect(
        (await failure(identity.send(IdentityRpc.verifyEmail, { token: oldToken })))
          .code,
      ).toBe('TOKEN_INVALID');
      await identity.send(IdentityRpc.verifyEmail, { token: newToken });

      // Verified: nothing more to send.
      await age(s.user.id);
      await identity.send(IdentityRpc.sendVerificationEmail, {}, as(s));
      await settled();
      expect(await mailpit.emailsTo(s.user.email)).toHaveLength(2);
    });

    it('refuses an expired link with TOKEN_EXPIRED', async () => {
      const s = await signUp();
      const token = tokenIn(
        (await mailpit.waitForEmails(s.user.email))[0],
        '/auth/verify-email',
      );
      await age(s.user.id, { expire: true });
      const err = await failure(
        identity.send(IdentityRpc.verifyEmail, { token }),
      );
      expect(err).toMatchObject({
        code: 'TOKEN_EXPIRED',
        message: 'This link has expired',
      });
    });

    it.each([
      ['malformed', 'not-a-token'],
      ['unknown', 'A'.repeat(43)],
    ])('refuses a %s token with TOKEN_INVALID', async (_, token) => {
      const err = await failure(
        identity.send(IdentityRpc.verifyEmail, { token }),
      );
      expect(err.code).toBe('TOKEN_INVALID');
    });
  });

  describe('password reset', () => {
    const requestReset = (email: string) =>
      identity.send(IdentityRpc.requestPasswordReset, { email });

    it('answers the same for unknown emails, and sends nothing', async () => {
      await expect(requestReset('nobody@example.com')).resolves.toBeUndefined();
      await settled();
      expect(await mailpit.emailsTo('nobody@example.com')).toHaveLength(0);
    });

    it('sets a new password, signs out everywhere, verifies the email and sends a notice', async () => {
      const s = await signUp('en');
      await mailpit.waitForEmails(s.user.email); // the verification email

      await requestReset(s.user.email.toUpperCase());
      const emails = await mailpit.waitForEmails(s.user.email, 2);
      expect(emails[1].subject).toBe('Choose a new BorrowBox password');
      const token = tokenIn(emails[1], '/auth/reset-password');
      const [{ ttl }] = await identity.dataSource.query(
        `SELECT extract(epoch FROM expires_at - created_at)::int AS ttl
           FROM email_tokens
          WHERE user_id = $1 AND kind = 'RESET_PASSWORD'`,
        [s.user.id],
      );
      expect(ttl).toBe(10 * 60);

      expect(
        (
          await failure(
            identity.send(IdentityRpc.resetPassword, {
              token,
              newPassword: 'short',
            }),
          )
        ).code,
      ).toBe('VALIDATION_FAILED');

      await identity.send(
        IdentityRpc.resetPassword,
        { token, newPassword: NEW_PASSWORD },
        { correlationId: 'reset-1' },
      );

      // Every session is gone, the new password works and the old one doesn't.
      expect(
        (
          await failure(
            identity.send(IdentityRpc.refresh, {
              refreshToken: s.refreshToken,
            }),
          )
        ).code,
      ).toBe('INVALID_REFRESH_TOKEN');
      expect(
        (
          await failure(
            identity.send(IdentityRpc.login, {
              email: s.user.email,
              password: PASSWORD,
            }),
          )
        ).code,
      ).toBe('INVALID_CREDENTIALS');
      const after = await identity.send(IdentityRpc.login, {
        email: s.user.email,
        password: NEW_PASSWORD,
      });
      expect(after.user.emailVerified).toBe(true);
      expect(await verifiedEvents(s.user.id)).toHaveLength(1);

      const all = await mailpit.waitForEmails(s.user.email, 3);
      expect(all[2].subject).toBe('Your BorrowBox password was changed');
      expect(all[2].text).toContain(
        'https://borrowbox.test/auth/forgot-password',
      );

      expect(
        (
          await failure(
            identity.send(IdentityRpc.resetPassword, {
              token,
              newPassword: 'another one 9',
            }),
          )
        ).code,
      ).toBe('TOKEN_INVALID');
    });

    it('lets an account without a password set one', async () => {
      const s = await signUp();
      await identity.dataSource.query(
        `UPDATE users SET password_hash = NULL WHERE id = $1`,
        [s.user.id],
      );
      await requestReset(s.user.email);
      const emails = await mailpit.waitForEmails(s.user.email, 2);
      await identity.send(IdentityRpc.resetPassword, {
        token: tokenIn(emails[1], '/auth/reset-password'),
        newPassword: NEW_PASSWORD,
      });
      const after = await identity.send(IdentityRpc.login, {
        email: s.user.email,
        password: NEW_PASSWORD,
      });
      expect(after.user.hasPassword).toBe(true);
    });

    it('lets one link succeed only once, even when used twice at the same time', async () => {
      const s = await signUp();
      await requestReset(s.user.email);
      const emails = await mailpit.waitForEmails(s.user.email, 2);
      const token = tokenIn(emails[1], '/auth/reset-password');

      const results = await Promise.allSettled([
        identity.send(IdentityRpc.resetPassword, {
          token,
          newPassword: NEW_PASSWORD,
        }),
        identity.send(IdentityRpc.resetPassword, {
          token,
          newPassword: 'another one 9',
        }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect((rejected as PromiseRejectedResult).reason.code).toBe(
        'TOKEN_INVALID',
      );
    });

    it('does not accept a verification link as a reset link', async () => {
      const s = await signUp();
      const token = tokenIn(
        (await mailpit.waitForEmails(s.user.email))[0],
        '/auth/verify-email',
      );
      const err = await failure(
        identity.send(IdentityRpc.resetPassword, {
          token,
          newPassword: NEW_PASSWORD,
        }),
      );
      expect(err.code).toBe('TOKEN_INVALID');
    });

    it('sends at most one link per cooldown', async () => {
      const s = await signUp();
      await mailpit.waitForEmails(s.user.email);
      await requestReset(s.user.email);
      await requestReset(s.user.email);
      await settled();
      expect(await mailpit.emailsTo(s.user.email)).toHaveLength(2);
    });
  });

  describe('change password', () => {
    const change = (s: AuthSession, currentPassword: string) =>
      identity.send(
        IdentityRpc.changePassword,
        { currentPassword, newPassword: NEW_PASSWORD },
        as(s),
      );

    it('needs the current password', async () => {
      const s = await signUp();
      expect((await failure(change(s, 'wrong password 1'))).code).toBe(
        'INVALID_CREDENTIALS',
      );
    });

    it('is refused for accounts without a password', async () => {
      const s = await signUp();
      await identity.dataSource.query(
        `UPDATE users SET password_hash = NULL WHERE id = $1`,
        [s.user.id],
      );
      expect((await failure(change(s, PASSWORD))).code).toBe(
        'PASSWORD_NOT_SET',
      );
    });

    it('keeps this session, signs out the others and sends a notice', async () => {
      const s = await signUp();
      const other = await identity.send(IdentityRpc.login, {
        email: s.user.email,
        password: PASSWORD,
      });

      await change(s, PASSWORD);

      await expect(
        identity.send(IdentityRpc.refresh, { refreshToken: s.refreshToken }),
      ).resolves.toBeDefined();
      expect(
        (
          await failure(
            identity.send(IdentityRpc.refresh, {
              refreshToken: other.refreshToken,
            }),
          )
        ).code,
      ).toBe('INVALID_REFRESH_TOKEN');
      await expect(
        identity.send(IdentityRpc.login, {
          email: s.user.email,
          password: NEW_PASSWORD,
        }),
      ).resolves.toBeDefined();

      const emails = await mailpit.waitForEmails(s.user.email, 2);
      expect(emails[1].subject).toBe('Ο κωδικός σου στο BorrowBox άλλαξε');
    });
  });

  it('forgets email links when the account is deleted', async () => {
    const s = await signUp();
    await mailpit.waitForEmails(s.user.email);
    await identity.send(IdentityRpc.deleteMe, { password: PASSWORD }, as(s));
    const [{ links }] = await identity.dataSource.query(
      `SELECT count(*)::int AS links FROM email_tokens WHERE user_id = $1`,
      [s.user.id],
    );
    expect(links).toBe(0);
  });
});
