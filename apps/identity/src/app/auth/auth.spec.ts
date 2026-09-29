import { createAccessTokenVerifier } from '@borrowbox/auth';
import {
  IdentityRpc,
  type AuthSession,
  type EventEnvelope,
  type RpcErrorBody,
  type UserRegisteredV1Payload,
} from '@borrowbox/contracts';
import {
  startPostgres,
  startRabbitMq,
  type TestPostgres,
  type TestRabbitMq,
} from '@borrowbox/testing';
import {
  startIdentity,
  type IdentityHarness,
} from '../../testing/identity-harness';
import { hashRefreshToken } from './refresh-token';

/** Email + password auth over the real TCP transport, Postgres and RabbitMQ. */
describe('Identity password auth (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let identity: IdentityHarness;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    [pg, rabbit] = await Promise.all([startPostgres(), startRabbitMq()]);
    identity = await startIdentity({
      databaseUrl: pg.urlFor('identity'),
      rabbitmqUrl: rabbit.url,
    });
  });

  afterAll(async () => {
    await identity?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop()]);
  });

  let n = 0;
  const newUser = () => ({
    email: `user${++n}@example.com`,
    password: 'correct horse 42',
    displayName: `User ${n}`,
  });
  const credentials = (u: { email: string; password: string }) => ({
    email: u.email,
    password: u.password,
  });
  const register = (data: unknown, correlationId?: string) =>
    identity.send(IdentityRpc.register, data, { correlationId });
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => {
        throw new Error('expected the call to fail');
      },
      (err: RpcErrorBody) => err,
    );

  describe('register', () => {
    it('creates the user, signs in and writes exactly one user.registered.v1 outbox row', async () => {
      const input = { ...newUser(), email: `  Mixed.Case${n}@Example.com ` };
      const session = await register({ ...input, locale: 'en' }, 'reg-flow-1');

      expect(session.user).toEqual({
        id: expect.any(String),
        email: input.email.trim(),
        displayName: input.displayName,
        locale: 'en',
        emailVerified: false,
        hasPassword: true,
        providers: [],
        createdAt: expect.any(String),
      });
      const verifier = await createAccessTokenVerifier(identity.keys);
      await expect(verifier.verify(session.accessToken)).resolves.toEqual(
        expect.objectContaining({ userId: session.user.id }),
      );

      const rows: Array<{
        routing_key: string;
        envelope: EventEnvelope<UserRegisteredV1Payload>;
      }> = await identity.dataSource.query(
        `SELECT routing_key, envelope FROM outbox WHERE envelope->'payload'->>'userId' = $1`,
        [session.user.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].routing_key).toBe('user.registered.v1');
      expect(rows[0].envelope).toMatchObject({
        correlationId: 'reg-flow-1',
        causationId: null,
        payload: {
          userId: session.user.id,
          email: input.email.trim(),
          displayName: input.displayName,
          locale: 'en',
        },
      });
    });

    it('stores an argon2id hash, never the password', async () => {
      const input = newUser();
      const session = await register(input);
      const [row] = await identity.dataSource.query(
        `SELECT password_hash FROM users WHERE id = $1`,
        [session.user.id],
      );
      expect(row.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
      expect(row.password_hash).not.toContain(input.password);
    });

    it('defaults the locale to el', async () => {
      expect((await register(newUser())).user.locale).toBe('el');
    });

    it('rejects a duplicate email regardless of case, without a second event', async () => {
      const input = newUser();
      await register(input);
      const err = await failure(
        register({ ...newUser(), email: input.email.toUpperCase() }),
      );
      expect(err).toEqual({
        code: 'EMAIL_TAKEN',
        message: 'Email is already registered',
      });
      const [{ count }] = await identity.dataSource.query(
        `SELECT count(*)::int AS count FROM users WHERE lower(email) = lower($1)`,
        [input.email],
      );
      expect(count).toBe(1);
    });

    it.each([
      ['a short password', { password: 'abc1' }],
      ['a password without digits', { password: 'abcdefghij' }],
      ['a password without letters', { password: '1234567890' }],
      ['a password over 64 chars', { password: 'a1'.repeat(33) }],
      ['an invalid email', { email: 'not-an-email' }],
      ['a blank display name', { displayName: '   ' }],
      ['an unknown locale', { locale: 'de' }],
      ['an unknown field', { isAdmin: true }],
    ])('rejects %s with VALIDATION_FAILED', async (_, override) => {
      const err = await failure(register({ ...newUser(), ...override }));
      expect(err.code).toBe('VALIDATION_FAILED');
      // Names fields, never echoes values.
      expect(err.message).not.toContain(String(Object.values(override)[0]));
    });

    it('rejects a message without data or with a bad correlation id', async () => {
      expect((await failure(register(undefined))).code).toBe(
        'VALIDATION_FAILED',
      );
      expect((await failure(register(newUser(), 'bad id!'))).code).toBe(
        'VALIDATION_FAILED',
      );
    });
  });

  describe('login', () => {
    it('signs in with the right password, case-insensitively on email', async () => {
      const input = newUser();
      const registered = await register(input);
      const session = await identity.send(IdentityRpc.login, {
        email: ` ${input.email.toUpperCase()} `,
        password: input.password,
      });
      expect(session.user.id).toBe(registered.user.id);
      expect(session.refreshToken).not.toBe(registered.refreshToken);
    });

    it('gives the same error for a wrong password, an unknown email and a deleted account', async () => {
      const input = newUser();
      const { user } = await register(input);
      const wrongPassword = await failure(
        identity.send(IdentityRpc.login, {
          email: input.email,
          password: 'wrong pass 1',
        }),
      );
      const unknownEmail = await failure(
        identity.send(IdentityRpc.login, {
          email: 'nobody@example.com',
          password: input.password,
        }),
      );
      await identity.dataSource.query(
        `UPDATE users SET deleted_at = now() WHERE id = $1`,
        [user.id],
      );
      const deleted = await failure(
        identity.send(IdentityRpc.login, credentials(input)),
      );

      const expected = {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      };
      expect([wrongPassword, unknownEmail, deleted]).toEqual([
        expected,
        expected,
        expected,
      ]);
    });

    it('rejects an OAuth-only account (no password) the same way', async () => {
      const input = newUser();
      const { user } = await register(input);
      await identity.dataSource.query(
        `UPDATE users SET password_hash = NULL WHERE id = $1`,
        [user.id],
      );
      expect(
        (await failure(identity.send(IdentityRpc.login, credentials(input))))
          .code,
      ).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('refresh', () => {
    const refresh = (refreshToken: string) =>
      identity.send(IdentityRpc.refresh, { refreshToken });

    it('rotates: a new pair, same family, same 30-day expiry', async () => {
      const first = await register(newUser());
      const second = await refresh(first.refreshToken);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.accessToken).not.toBe(first.accessToken);
      expect(second.refreshTokenExpiresAt).toBe(first.refreshTokenExpiresAt);
      expect(
        Date.parse(first.refreshTokenExpiresAt) - Date.now(),
      ).toBeGreaterThan(29.9 * 24 * 3600 * 1000);

      const rows = await identity.dataSource.query(
        `SELECT family_id, rotated_at FROM refresh_tokens
          WHERE token_hash = ANY($1) ORDER BY created_at`,
        [
          [
            hashRefreshToken(first.refreshToken),
            hashRefreshToken(second.refreshToken),
          ],
        ],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].family_id).toBe(rows[1].family_id);
      expect(rows[0].rotated_at).not.toBeNull();
      expect(rows[1].rotated_at).toBeNull();
    });

    it('on reuse of a rotated token, revokes the whole family', async () => {
      const first = await register(newUser());
      const second = await refresh(first.refreshToken);

      // Attacker (or a stale copy) replays the old token.
      expect((await failure(refresh(first.refreshToken))).code).toBe(
        'INVALID_REFRESH_TOKEN',
      );
      // The legitimate holder's newer token is now dead too.
      expect((await failure(refresh(second.refreshToken))).code).toBe(
        'INVALID_REFRESH_TOKEN',
      );
      // Other sessions of the same user are unaffected.
      const other = await identity.send(IdentityRpc.login, {
        email: first.user.email,
        password: 'correct horse 42',
      });
      await expect(refresh(other.refreshToken)).resolves.toBeDefined();
    });

    it('rejects expired, unknown and malformed tokens', async () => {
      const s = await register(newUser());
      await identity.dataSource.query(
        `UPDATE refresh_tokens SET expires_at = now() - interval '1 second'
          WHERE token_hash = $1`,
        [hashRefreshToken(s.refreshToken)],
      );
      for (const token of [s.refreshToken, 'A'.repeat(43), 'not-a-token']) {
        expect((await failure(refresh(token))).code).toBe(
          'INVALID_REFRESH_TOKEN',
        );
      }
    });

    it("rejects a deleted account's tokens", async () => {
      const s = await register(newUser());
      await identity.dataSource.query(
        `UPDATE users SET deleted_at = now() WHERE id = $1`,
        [s.user.id],
      );
      expect((await failure(refresh(s.refreshToken))).code).toBe(
        'INVALID_REFRESH_TOKEN',
      );
    });
  });

  describe('logout', () => {
    it('ends the session family and is idempotent', async () => {
      const first: AuthSession = await register(newUser());
      const second = await identity.send(IdentityRpc.refresh, {
        refreshToken: first.refreshToken,
      });

      await expect(
        identity.send(IdentityRpc.logout, {
          refreshToken: second.refreshToken,
        }),
      ).resolves.toBeUndefined();
      await expect(
        identity.send(IdentityRpc.logout, {
          refreshToken: second.refreshToken,
        }),
      ).resolves.toBeUndefined();
      await expect(
        identity.send(IdentityRpc.logout, { refreshToken: 'A'.repeat(43) }),
      ).resolves.toBeUndefined();

      expect(
        (
          await failure(
            identity.send(IdentityRpc.refresh, {
              refreshToken: second.refreshToken,
            }),
          )
        ).code,
      ).toBe('INVALID_REFRESH_TOKEN');
    });
  });
});
