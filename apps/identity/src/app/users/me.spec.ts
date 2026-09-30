import { generateKeyPairSync } from 'node:crypto';
import { createAccessTokenSigner } from '@borrowbox/auth';
import {
  IdentityRpc,
  type AuthSession,
  type RpcErrorBody,
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
import { hashRefreshToken } from '../auth/refresh-token';

/** Profile, GDPR export and deletion over the real TCP transport. */
describe('Identity me.* (integration)', () => {
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

  const PASSWORD = 'correct horse 42';
  let n = 0;
  const signUp = (): Promise<AuthSession> =>
    identity.send(
      IdentityRpc.register,
      {
        email: `me${++n}@example.com`,
        password: PASSWORD,
        displayName: `Me ${n}`,
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

  describe('authentication', () => {
    it('rejects calls without a token or with a token from another key', async () => {
      expect(await failure(identity.send(IdentityRpc.getMe, {}))).toEqual({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });

      const s = await signUp();
      const { privateKey } = generateKeyPairSync('ed25519', {
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const forger = await createAccessTokenSigner({
        privateKeyPem: privateKey,
        keyId: identity.keys.keyId,
      });
      const forged = await forger.sign({
        userId: s.user.id,
        sessionId: '00000000-0000-4000-8000-000000000000',
      });
      expect(
        (
          await failure(
            identity.send(IdentityRpc.getMe, {}, { accessToken: forged.token }),
          )
        ).code,
      ).toBe('UNAUTHENTICATED');
    });
  });

  describe('get / update', () => {
    it('returns and updates the caller’s own profile', async () => {
      const s = await signUp();
      await expect(
        identity.send(IdentityRpc.getMe, {}, as(s)),
      ).resolves.toEqual(s.user);

      const updated = await identity.send(
        IdentityRpc.updateMe,
        { displayName: '  Ελένη  ', locale: 'en' },
        as(s),
      );
      expect(updated).toEqual({
        ...s.user,
        displayName: 'Ελένη',
        locale: 'en',
      });

      // Partial update keeps other fields.
      const partial = await identity.send(
        IdentityRpc.updateMe,
        { locale: 'el' },
        as(s),
      );
      expect(partial.displayName).toBe('Ελένη');
    });

    it.each([
      ['a blank name', { displayName: ' ' }],
      ['a 51-char name', { displayName: 'x'.repeat(51) }],
      ['an unknown locale', { locale: 'fr' }],
      ['another user id', { userId: '00000000-0000-4000-8000-000000000000' }],
      ['an email change', { email: 'new@example.com' }],
    ])('rejects %s', async (_, data) => {
      const s = await signUp();
      expect(
        (await failure(identity.send(IdentityRpc.updateMe, data, as(s)))).code,
      ).toBe('VALIDATION_FAILED');
    });
  });

  describe('export', () => {
    it('contains the user, providers and one entry per session, and no secrets', async () => {
      const s = await signUp();
      const second = await identity.send(IdentityRpc.login, {
        email: s.user.email,
        password: PASSWORD,
      });
      await identity.send(IdentityRpc.refresh, {
        refreshToken: second.refreshToken,
      });

      const data = await identity.send(IdentityRpc.exportMe, {}, as(s));
      expect(data.user).toEqual({
        id: s.user.id,
        email: s.user.email,
        displayName: s.user.displayName,
        locale: 'el',
        emailVerifiedAt: null,
        createdAt: s.user.createdAt,
        updatedAt: expect.any(String),
      });
      expect(data.oauthIdentities).toEqual([]);
      // Two sign-ins; the refresh rotated within the second session.
      expect(data.sessions).toHaveLength(2);

      const json = JSON.stringify(data);
      for (const secret of [
        '$argon2',
        PASSWORD,
        s.refreshToken,
        second.refreshToken,
        s.accessToken,
      ]) {
        expect(json).not.toContain(secret);
      }
    });
  });

  describe('delete', () => {
    const deleteMe = (s: AuthSession, data: unknown, correlationId?: string) =>
      identity.send(IdentityRpc.deleteMe, data, as(s, correlationId));

    it('requires the current password for password accounts', async () => {
      const s = await signUp();
      expect((await failure(deleteMe(s, {}))).code).toBe(
        'REAUTHENTICATION_REQUIRED',
      );
      expect(
        (await failure(deleteMe(s, { password: 'wrong pass 1' }))).code,
      ).toBe('INVALID_CREDENTIALS');
      await expect(
        identity.send(IdentityRpc.getMe, {}, as(s)),
      ).resolves.toBeDefined();
    });

    it('erases Identity’s personal data and emits user.deletion_requested.v1 in one go', async () => {
      const s = await signUp();
      const other = await identity.send(IdentityRpc.login, {
        email: s.user.email,
        password: PASSWORD,
      });
      await identity.dataSource.query(
        `INSERT INTO oauth_identities (provider, subject, user_id) VALUES ('google', $1, $2)`,
        [`sub-${s.user.id}`, s.user.id],
      );

      await expect(
        deleteMe(s, { password: PASSWORD }, 'delete-flow-1'),
      ).resolves.toBeUndefined();

      const [user] = await identity.dataSource.query(
        `SELECT email, display_name, password_hash, email_verified_at, deleted_at
           FROM users WHERE id = $1`,
        [s.user.id],
      );
      expect(user).toEqual({
        email: `deleted+${s.user.id}@invalid`,
        display_name: null,
        password_hash: null,
        email_verified_at: null,
        deleted_at: expect.any(Date),
      });
      const counts = await identity.dataSource.query(
        `SELECT (SELECT count(*)::int FROM oauth_identities WHERE user_id = $1) AS identities,
                (SELECT count(*)::int FROM refresh_tokens   WHERE user_id = $1) AS tokens`,
        [s.user.id],
      );
      expect(counts[0]).toEqual({ identities: 0, tokens: 0 });

      // Exactly one deletion event, correlated with the request.
      const events = await identity.dataSource.query(
        `SELECT routing_key, envelope FROM outbox
          WHERE envelope->'payload'->>'userId' = $1 ORDER BY id`,
        [s.user.id],
      );
      expect(events.map((e: { routing_key: string }) => e.routing_key)).toEqual(
        ['user.registered.v1', 'user.deletion_requested.v1'],
      );
      expect(events[1].envelope).toMatchObject({
        correlationId: 'delete-flow-1',
        payload: { userId: s.user.id },
      });
      // The kept user.registered row no longer holds the email or name.
      expect(events[0].envelope.payload).toEqual({
        userId: s.user.id,
        email: `deleted+${s.user.id}@invalid`,
        displayName: 'Deleted user',
        locale: 'el',
      });
      expect(JSON.stringify(events)).not.toContain(s.user.email);

      // Every way back in is closed.
      const calls = [
        () => identity.send(IdentityRpc.getMe, {}, as(s)),
        () => identity.send(IdentityRpc.updateMe, { locale: 'en' }, as(s)),
        () => identity.send(IdentityRpc.exportMe, {}, as(s)),
      ];
      for (const call of calls) {
        expect((await failure(call())).code).toBe('UNAUTHENTICATED');
      }
    });

    it('refuses once the access token’s session was logged out', async () => {
      const s = await signUp();
      await identity.send(IdentityRpc.logout, {
        refreshToken: s.refreshToken,
      });
      expect((await failure(deleteMe(s, { password: PASSWORD }))).code).toBe(
        'UNAUTHENTICATED',
      );
      const [row] = await identity.dataSource.query(
        `SELECT revoked_at FROM refresh_tokens WHERE token_hash = $1`,
        [hashRefreshToken(s.refreshToken)],
      );
      expect(row.revoked_at).not.toBeNull();
    });
  });
});
