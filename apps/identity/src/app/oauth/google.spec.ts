import { createAccessTokenVerifier } from '@borrowbox/auth';
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
  FakeOidcProvider,
  type FakeGoogleUser,
} from '../../testing/fake-oidc-provider';
import {
  startIdentity,
  type IdentityHarness,
} from '../../testing/identity-harness';
import { displayNameFor } from './google-auth.service';

/** Google sign-in against a local fake OpenID Provider (no network). */
describe('Identity Google sign-in (integration)', () => {
  let pg: TestPostgres;
  let rabbit: TestRabbitMq;
  let google: FakeOidcProvider;
  let identity: IdentityHarness;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    [pg, rabbit, google] = await Promise.all([
      startPostgres(),
      startRabbitMq(),
      FakeOidcProvider.start(),
    ]);
    identity = await startIdentity({
      databaseUrl: pg.urlFor('identity'),
      rabbitmqUrl: rabbit.url,
      env: google.env,
    });
  });

  afterAll(async () => {
    await identity?.close();
    process.env = savedEnv;
    await Promise.all([pg?.stop(), rabbit?.stop(), google?.stop()]);
  });

  let n = 0;
  const googleUser = (over: Partial<FakeGoogleUser> = {}): FakeGoogleUser => ({
    sub: `google-sub-${++n}`,
    email: `g${n}@gmail.example`,
    email_verified: true,
    name: `Google User ${n}`,
    ...over,
  });
  const signIn = (
    user: FakeGoogleUser,
    correlationId?: string,
  ): Promise<AuthSession> =>
    identity.send(IdentityRpc.googleExchange, google.authorize(user), {
      correlationId,
    });
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => {
        throw new Error('expected the call to fail');
      },
      (err: RpcErrorBody) => err,
    );
  const registeredEvents = (userId: string) =>
    identity.dataSource.query(
      `SELECT envelope FROM outbox
        WHERE routing_key = 'user.registered.v1'
          AND envelope->'payload'->>'userId' = $1`,
      [userId],
    );

  it('creates a verified, password-less account on first sign-in', async () => {
    const user = googleUser();
    const session = await signIn(user, 'google-flow-1');

    expect(session.user).toEqual({
      id: expect.any(String),
      email: user.email,
      displayName: user.name,
      locale: 'el',
      emailVerified: true,
      hasPassword: false,
      providers: ['google'],
      createdAt: expect.any(String),
    });
    const verifier = await createAccessTokenVerifier(identity.keys);
    await expect(verifier.verify(session.accessToken)).resolves.toEqual(
      expect.objectContaining({ userId: session.user.id }),
    );

    const events = await registeredEvents(session.user.id);
    expect(events).toHaveLength(1);
    expect(events[0].envelope).toMatchObject({
      correlationId: 'google-flow-1',
      payload: {
        userId: session.user.id,
        email: user.email,
        displayName: user.name,
        locale: 'el',
      },
    });
  });

  it('signs the same Google account into the same user, with no second event', async () => {
    const user = googleUser();
    const first = await signIn(user);
    // Google may report a changed email/name; the stable `sub` decides.
    const second = await signIn({ ...user, email: 'renamed@gmail.example' });
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.email).toBe(user.email);
    expect(await registeredEvents(first.user.id)).toHaveLength(1);
  });

  it('refuses an email Google has not verified, creating nothing', async () => {
    const user = googleUser({ email_verified: false });
    expect(await failure(signIn(user))).toEqual({
      code: 'OAUTH_EMAIL_NOT_VERIFIED',
      message: 'Your Google account email is not verified',
    });
    const rows = await identity.dataSource.query(
      `SELECT 1 FROM users WHERE lower(email) = lower($1)`,
      [user.email],
    );
    expect(rows).toHaveLength(0);
  });

  describe('auto-linking by verified email', () => {
    it('defeats pre-hijacking: an unverified password account is taken over by the Google owner', async () => {
      const victim = googleUser();
      // The attacker registers the victim's email first, with their own password.
      const attacker: AuthSession = await identity.send(IdentityRpc.register, {
        email: victim.email.toUpperCase(),
        password: 'attacker pass 1',
        displayName: 'Attacker',
      });

      const session = await signIn(victim);
      expect(session.user).toMatchObject({
        id: attacker.user.id,
        emailVerified: true,
        hasPassword: false,
        providers: ['google'],
      });

      // The attacker's password and session no longer work…
      expect(
        (
          await failure(
            identity.send(IdentityRpc.login, {
              email: victim.email,
              password: 'attacker pass 1',
            }),
          )
        ).code,
      ).toBe('INVALID_CREDENTIALS');
      expect(
        (
          await failure(
            identity.send(IdentityRpc.refresh, {
              refreshToken: attacker.refreshToken,
            }),
          )
        ).code,
      ).toBe('INVALID_REFRESH_TOKEN');
      expect(
        (
          await failure(
            identity.send(
              IdentityRpc.deleteMe,
              { password: 'attacker pass 1' },
              { accessToken: attacker.accessToken },
            ),
          )
        ).code,
      ).toBe('UNAUTHENTICATED');
      // …while the Google owner's does.
      await expect(
        identity.send(IdentityRpc.refresh, {
          refreshToken: session.refreshToken,
        }),
      ).resolves.toBeDefined();
    });

    it('keeps the password and sessions of an already verified account', async () => {
      const owner = googleUser();
      const existing: AuthSession = await identity.send(IdentityRpc.register, {
        email: owner.email,
        password: 'owner pass 12',
        displayName: 'Owner',
      });
      await identity.dataSource.query(
        `UPDATE users SET email_verified_at = now() WHERE id = $1`,
        [existing.user.id],
      );

      const session = await signIn(owner);
      expect(session.user).toMatchObject({
        id: existing.user.id,
        hasPassword: true,
        providers: ['google'],
      });
      await expect(
        identity.send(IdentityRpc.login, {
          email: owner.email,
          password: 'owner pass 12',
        }),
      ).resolves.toBeDefined();
      await expect(
        identity.send(IdentityRpc.refresh, {
          refreshToken: existing.refreshToken,
        }),
      ).resolves.toBeDefined();
    });

    it('does not attach a second Google account to the same email', async () => {
      const original = googleUser();
      await signIn(original);
      const other = googleUser({ email: original.email });
      expect(await failure(signIn(other))).toEqual({
        code: 'OAUTH_EXCHANGE_FAILED',
        message: 'This email is linked to a different Google account',
      });
    });
  });

  describe('exchange security', () => {
    it('rejects a wrong PKCE verifier, a replayed code and a nonce mismatch', async () => {
      const user = googleUser();

      const wrongVerifier = google.authorize(user);
      expect(
        (
          await failure(
            identity.send(IdentityRpc.googleExchange, {
              ...wrongVerifier,
              codeVerifier: 'x'.repeat(43),
            }),
          )
        ).code,
      ).toBe('OAUTH_EXCHANGE_FAILED');

      const once = google.authorize(user);
      await identity.send(IdentityRpc.googleExchange, once);
      expect(
        (await failure(identity.send(IdentityRpc.googleExchange, once))).code,
      ).toBe('OAUTH_EXCHANGE_FAILED');

      const replayedIdToken = google.authorize(user, { nonce: 'other-nonce' });
      expect(
        (
          await failure(
            identity.send(IdentityRpc.googleExchange, replayedIdToken),
          )
        ).code,
      ).toBe('OAUTH_EXCHANGE_FAILED');
    });

    it.each([
      ['a short code verifier', { codeVerifier: 'short' }],
      ['a non-URL redirect', { redirectUri: 'not a url' }],
      ['an unknown field', { email: 'x@example.com' }],
    ])('rejects %s with VALIDATION_FAILED', async (_, override) => {
      const input = { ...google.authorize(googleUser()), ...override };
      expect(
        (await failure(identity.send(IdentityRpc.googleExchange, input))).code,
      ).toBe('VALIDATION_FAILED');
    });
  });
});

describe('displayNameFor', () => {
  const base = { subject: 's', emailVerified: true };
  it('uses the name, else the email local part, cut to 50 characters', () => {
    expect(displayNameFor({ ...base, email: 'a@b.c', name: '  Μαρία  ' })).toBe(
      'Μαρία',
    );
    expect(
      displayNameFor({ ...base, email: 'nikos.p@gmail.com', name: ' ' }),
    ).toBe('nikos.p');
    expect(
      displayNameFor({ ...base, email: 'a@b.c', name: 'x'.repeat(80) }),
    ).toHaveLength(50);
  });
});
