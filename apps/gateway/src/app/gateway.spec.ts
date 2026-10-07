import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import {
  createAccessTokenSigner,
  type AccessTokenSigner,
} from '@borrowbox/auth';
import {
  CatalogRpc,
  IdentityRpc,
  type AuthSession,
  type RpcRequest,
  type UserProfile,
} from '@borrowbox/contracts';
import { startRedis, type TestRedis } from '@borrowbox/testing';
import { FakeCatalog, FakeIdentity } from '../testing/fake-service';

const WEB = 'http://localhost:4200';
const GOOGLE_AUTH = 'https://accounts.example/o/oauth2/auth';
const GOOGLE_REDIRECT = `${WEB}/api/auth/google/callback`;

const user: UserProfile = {
  id: '6f1b0c55-8d2e-4a3b-9c4d-1e2f3a4b5c6d',
  email: 'ana@example.com',
  displayName: 'Ana',
  locale: 'el',
  emailVerified: false,
  hasPassword: true,
  providers: [],
  createdAt: '2026-09-01T10:00:00.000Z',
};
const session = (n = 1): AuthSession => ({
  accessToken: `access-${n}`,
  accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  refreshToken: `refresh-token-${n}`,
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  user,
});

/** HTTP behaviour of the gateway, with a real Redis and a fake Identity over TCP. */
describe('Gateway (integration)', () => {
  let redis: TestRedis;
  let identity: FakeIdentity;
  let catalog: FakeCatalog;
  let app: NestExpressApplication;
  let signer: AccessTokenSigner;
  let otherSigner: AccessTokenSigner;
  let redisClient: Redis;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    redis = await startRedis();
    identity = new FakeIdentity();
    catalog = new FakeCatalog();
    await Promise.all([identity.start(), catalog.start()]);

    const keys = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const otherKeys = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    signer = await createAccessTokenSigner({
      privateKeyPem: keys.privateKey,
      keyId: 'test-key',
    });
    otherSigner = await createAccessTokenSigner({
      privateKeyPem: otherKeys.privateKey,
      keyId: 'test-key',
    });

    Object.assign(process.env, {
      REDIS_URL: redis.url,
      IDENTITY_HOST: '127.0.0.1',
      IDENTITY_PORT: String(identity.port),
      CATALOG_HOST: '127.0.0.1',
      CATALOG_PORT: String(catalog.port),
      RPC_TIMEOUT_MS: '1000',
      COOKIE_SECRET: 'test-cookie-secret-0123456789abcdef',
      JWT_PUBLIC_KEY: keys.publicKey,
      JWT_KEY_ID: 'test-key',
      CORS_ORIGINS: WEB,
      WEB_APP_URL: WEB,
      GOOGLE_CLIENT_ID: 'test-client.apps.example',
      GOOGLE_AUTHORIZATION_ENDPOINT: GOOGLE_AUTH,
      GOOGLE_REDIRECT_URI: GOOGLE_REDIRECT,
      API_DOCS: 'false',
    });
    // ConfigModule.forRoot validates env when app.module is first imported.
    const { AppModule } = await import('./app.module');
    const { configureApp } = await import('./bootstrap');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureApp(app);
    await app.init();
    redisClient = new Redis(redis.url);
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([identity?.stop(), catalog?.stop()]);
    await redisClient?.quit();
    process.env = savedEnv;
    await redis?.stop();
  });

  beforeEach(async () => {
    identity.reset();
    catalog.reset();
    await redisClient.flushall(); // rate-limit counters
  });

  const http = () => request(app.getHttpServer());
  const bearer = async (s: AccessTokenSigner = signer) =>
    `Bearer ${(await s.sign({ userId: user.id, sessionId: 'sess-1' })).token}`;
  const cookies = (res: request.Response): string[] =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = (res: request.Response, name: string) =>
    cookies(res).find((c) => c.startsWith(`${name}=`));

  describe('basics', () => {
    it('serves health with security headers and a correlation id', async () => {
      const res = await http().get('/api/health').expect(200);
      expect(res.body).toEqual({ status: 'ok' });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

      const own = await http()
        .get('/api/health')
        .set('X-Request-Id', 'req-123')
        .expect(200);
      expect(own.headers['x-request-id']).toBe('req-123');
      const unsafe = await http()
        .get('/api/health')
        .set('X-Request-Id', 'bad id <script>')
        .expect(200);
      expect(unsafe.headers['x-request-id']).not.toContain('<');
    });

    it('answers unknown routes and oversized bodies with the standard error shape', async () => {
      expect((await http().get('/api/nope').expect(404)).body).toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
      const big = await http()
        .post('/api/auth/login')
        .send({ email: 'a@b.c', password: 'x'.repeat(200_000) })
        .expect(413);
      expect(big.body).toEqual({
        statusCode: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
      });
      const malformed = await http()
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "secret@example.com", ')
        .expect(400);
      expect(malformed.body).toEqual({
        statusCode: 400,
        code: 'MALFORMED_REQUEST',
        message: 'Malformed request',
      });
      // Nothing from the body is echoed back.
      expect(JSON.stringify(malformed.body)).not.toContain('secret');
    });

    it('allows CORS with credentials only for configured origins', async () => {
      const ok = await http()
        .options('/api/auth/login')
        .set('Origin', WEB)
        .set('Access-Control-Request-Method', 'POST');
      expect(ok.headers['access-control-allow-origin']).toBe(WEB);
      expect(ok.headers['access-control-allow-credentials']).toBe('true');

      const evil = await http()
        .options('/api/auth/login')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('register / login', () => {
    it('forwards to Identity and puts the refresh token only in a strict httpOnly cookie', async () => {
      identity.on(IdentityRpc.register, () => session());
      const res = await http()
        .post('/api/auth/register')
        .set('X-Request-Id', 'flow-42')
        .send({
          email: '  ana@example.com ',
          password: 'correct horse 42',
          displayName: 'Ana',
        })
        .expect(201);

      expect(res.body).toEqual({
        accessToken: 'access-1',
        accessTokenExpiresAt: expect.any(String),
        user,
      });
      expect(JSON.stringify(res.body)).not.toContain('refresh-token-1');
      const refresh = cookie(res, 'bb_refresh');
      expect(refresh).toMatch(/^bb_refresh=refresh-token-1;/);
      expect(refresh).toMatch(/; HttpOnly/);
      expect(refresh).toMatch(/; Secure/);
      expect(refresh).toMatch(/; SameSite=Strict/);
      expect(refresh).toMatch(/; Path=\/api\/auth;/);
      expect(refresh).toMatch(/; Expires=/);

      expect(identity.callsTo(IdentityRpc.register)).toEqual([
        {
          pattern: IdentityRpc.register,
          message: {
            correlationId: 'flow-42',
            data: {
              email: 'ana@example.com',
              password: 'correct horse 42',
              displayName: 'Ana',
            },
          },
        },
      ]);
    });

    it.each([
      ['a weak password', { password: 'password' }],
      ['an invalid email', { email: 'nope' }],
      ['an unknown field', { role: 'admin' }],
    ])('rejects %s with 400 before calling Identity', async (_, override) => {
      const res = await http()
        .post('/api/auth/register')
        .send({
          email: 'ana@example.com',
          password: 'correct horse 42',
          displayName: 'Ana',
          ...override,
        })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(identity.calls).toHaveLength(0);
    });

    it.each([
      ['EMAIL_TAKEN', 409],
      ['INVALID_CREDENTIALS', 401],
      ['VALIDATION_FAILED', 400],
      ['INTERNAL', 500],
    ])('maps Identity %s to HTTP %i', async (code, status) => {
      identity.fail(IdentityRpc.login, { code, message: `msg ${code}` });
      const res = await http()
        .post('/api/auth/login')
        .send({ email: 'ana@example.com', password: 'x' })
        .expect(status);
      expect(res.body).toEqual({
        statusCode: status,
        code,
        message: `msg ${code}`,
      });
      expect(cookie(res, 'bb_refresh')).toBeUndefined();
    });

    it('answers 503 when Identity does not respond in time', async () => {
      identity.on(IdentityRpc.login, () => new Promise(() => undefined));
      const res = await http()
        .post('/api/auth/login')
        .send({ email: 'ana@example.com', password: 'x' })
        .expect(503);
      expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('rate-limits login to 10 per minute per IP (counters in Redis)', async () => {
      identity.fail(IdentityRpc.login, {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
      for (let i = 0; i < 10; i++) {
        await http()
          .post('/api/auth/login')
          .send({ email: 'ana@example.com', password: 'guess' })
          .expect(401);
      }
      const res = await http()
        .post('/api/auth/login')
        .send({ email: 'ana@example.com', password: 'guess' })
        .expect(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      expect(identity.callsTo(IdentityRpc.login)).toHaveLength(10);
      expect((await redisClient.keys('*')).length).toBeGreaterThan(0);
    });

    it('rate-limits account deletion (a password check) to 10 per minute', async () => {
      identity.fail(IdentityRpc.deleteMe, {
        code: 'INVALID_CREDENTIALS',
        message: 'Wrong password',
      });
      const token = await bearer();
      const attempt = () =>
        http()
          .delete('/api/me')
          .set('Authorization', token)
          .send({ password: 'guess' });
      for (let i = 0; i < 10; i++) await attempt().expect(401);
      expect((await attempt().expect(429)).body.code).toBe('RATE_LIMITED');
      expect(identity.callsTo(IdentityRpc.deleteMe)).toHaveLength(10);
    });

    it('keys rate limits on the client IP forwarded by a trusted proxy', async () => {
      // supertest connects from 127.0.0.1, which the default TRUST_PROXY
      // (loopback) trusts, like the Angular dev proxy or a same-host Caddy.
      identity.fail(IdentityRpc.login, {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
      const login = (clientIp: string) =>
        http()
          .post('/api/auth/login')
          .set('X-Forwarded-For', clientIp)
          .send({ email: 'ana@example.com', password: 'guess' });

      for (let i = 0; i < 10; i++) await login('203.0.113.1').expect(401);
      await login('203.0.113.1').expect(429);
      // Another client behind the same proxy has its own budget.
      await login('203.0.113.2').expect(401);
    });
  });

  describe('refresh / logout', () => {
    it('rejects a missing cookie without calling Identity', async () => {
      const res = await http().post('/api/auth/refresh').expect(401);
      expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
      expect(identity.calls).toHaveLength(0);
    });

    it('rotates the cookie', async () => {
      identity.on(IdentityRpc.refresh, () => session(2));
      const res = await http()
        .post('/api/auth/refresh')
        .set('Cookie', 'bb_refresh=refresh-token-1')
        .expect(200);
      expect(res.body.accessToken).toBe('access-2');
      expect(cookie(res, 'bb_refresh')).toMatch(/^bb_refresh=refresh-token-2;/);
      expect(identity.callsTo(IdentityRpc.refresh)[0].message.data).toEqual({
        refreshToken: 'refresh-token-1',
      });
    });

    it('clears the cookie when Identity rejects the token', async () => {
      identity.fail(IdentityRpc.refresh, {
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Session expired, sign in again',
      });
      const res = await http()
        .post('/api/auth/refresh')
        .set('Cookie', 'bb_refresh=stolen-and-reused')
        .expect(401);
      expect(cookie(res, 'bb_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it('logout revokes via Identity and clears the cookie', async () => {
      identity.on(IdentityRpc.logout, () => undefined);
      const res = await http()
        .post('/api/auth/logout')
        .set('Cookie', 'bb_refresh=refresh-token-1')
        .expect(204);
      expect(cookie(res, 'bb_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(identity.callsTo(IdentityRpc.logout)[0].message.data).toEqual({
        refreshToken: 'refresh-token-1',
      });
    });
  });

  describe('/me', () => {
    it('requires a valid access token and never calls Identity otherwise', async () => {
      await http().get('/api/me').expect(401);
      await http()
        .get('/api/me')
        .set('Authorization', await bearer(otherSigner))
        .expect(401);
      await http()
        .get('/api/me')
        .set('Authorization', 'Bearer x.y.z')
        .expect(401);
      expect(identity.calls).toHaveLength(0);
    });

    it('forwards the access token so Identity re-verifies it', async () => {
      identity.on(IdentityRpc.getMe, () => user);
      const auth = await bearer();
      const res = await http()
        .get('/api/me')
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toEqual(user);
      const message = identity.callsTo(IdentityRpc.getMe)[0]
        .message as RpcRequest<unknown>;
      expect(message.accessToken).toBe(auth.slice('Bearer '.length));
    });

    it('PATCH forwards only allowed fields', async () => {
      identity.on(IdentityRpc.updateMe, (m) => ({
        ...user,
        ...(m.data as object),
      }));
      const auth = await bearer();
      await http()
        .patch('/api/me')
        .set('Authorization', auth)
        .send({ displayName: ' Ελένη ', locale: 'en' })
        .expect(200);
      expect(identity.callsTo(IdentityRpc.updateMe)[0].message.data).toEqual({
        displayName: 'Ελένη',
        locale: 'en',
      });
      await http()
        .patch('/api/me')
        .set('Authorization', auth)
        .send({ email: 'x@example.com' })
        .expect(400);
    });

    it('export is a no-store download', async () => {
      const exported = {
        exportedAt: '2026-09-29T00:00:00.000Z',
        user: { ...user, emailVerifiedAt: null, updatedAt: user.createdAt },
        oauthIdentities: [],
        sessions: [],
      };
      const catalogExport = {
        exportedAt: '2026-09-29T00:00:00.000Z',
        lenderProfile: null,
        items: [],
      };
      identity.on(IdentityRpc.exportMe, () => exported);
      catalog.on(CatalogRpc.exportMe, () => catalogExport);
      const res = await http()
        .get('/api/me/export')
        .set('Authorization', await bearer())
        .expect(200);
      expect(res.body).toEqual({ identity: exported, catalog: catalogExport });
      // Both services verify the same token again.
      expect(catalog.callsTo(CatalogRpc.exportMe)[0].message.accessToken).toBe(
        identity.callsTo(IdentityRpc.exportMe)[0].message.accessToken,
      );
      expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('fails the whole export with 503 when a service does not answer', async () => {
      identity.on(IdentityRpc.exportMe, () => ({ exportedAt: 'x' }));
      catalog.on(CatalogRpc.exportMe, () => new Promise(() => undefined));
      const res = await http()
        .get('/api/me/export')
        .set('Authorization', await bearer())
        .expect(503);
      expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(JSON.stringify(res.body)).not.toContain('exportedAt');
    });

    it('DELETE forwards the password, answers 204 and clears the cookie', async () => {
      identity.on(IdentityRpc.deleteMe, () => undefined);
      const res = await http()
        .delete('/api/me')
        .set('Authorization', await bearer())
        .send({ password: 'correct horse 42' })
        .expect(204);
      expect(identity.callsTo(IdentityRpc.deleteMe)[0].message.data).toEqual({
        password: 'correct horse 42',
      });
      expect(cookie(res, 'bb_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it('maps REAUTHENTICATION_REQUIRED to 403', async () => {
      identity.fail(IdentityRpc.deleteMe, {
        code: 'REAUTHENTICATION_REQUIRED',
        message: 'Enter your password to delete your account',
      });
      const res = await http()
        .delete('/api/me')
        .set('Authorization', await bearer())
        .send({})
        .expect(403);
      expect(res.body.code).toBe('REAUTHENTICATION_REQUIRED');
    });
  });

  describe('Google sign-in', () => {
    /** Starts the flow; returns Google's query params and the signed state cookie. */
    const start = async () => {
      const res = await http().get('/api/auth/google').expect(302);
      const location = new URL(res.headers['location']);
      const oauth = cookie(res, 'bb_oauth') as string;
      return { location, oauth, cookiePair: oauth.split(';')[0] };
    };

    it('redirects to Google with PKCE (S256), state and nonce in a signed Lax cookie', async () => {
      const { location, oauth } = await start();
      expect(`${location.origin}${location.pathname}`).toBe(GOOGLE_AUTH);
      expect(Object.fromEntries(location.searchParams)).toEqual({
        client_id: 'test-client.apps.example',
        redirect_uri: GOOGLE_REDIRECT,
        response_type: 'code',
        scope: 'openid email profile',
        state: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        nonce: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      expect(oauth).toMatch(/^bb_oauth=s%3A/); // cookie-parser signed value
      expect(oauth).toMatch(/; HttpOnly/);
      expect(oauth).toMatch(/; Secure/);
      expect(oauth).toMatch(/; SameSite=Lax/);
      expect(oauth).toMatch(/; Path=\/api\/auth\/google;/);
      // The verifier itself never leaves the cookie.
      expect(location.search).not.toMatch(/code_verifier/);
    });

    it('exchanges the code with the stored verifier and nonce, then returns to the web app', async () => {
      identity.on(IdentityRpc.googleExchange, () => session(3));
      const { location, cookiePair } = await start();
      const res = await http()
        .get('/api/auth/google/callback')
        .query({
          code: 'google-code',
          state: location.searchParams.get('state'),
          iss: 'https://accounts.google.com',
        })
        .set('Cookie', cookiePair)
        .expect(302);

      expect(res.headers['location']).toBe(`${WEB}/auth/callback`);
      expect(cookie(res, 'bb_refresh')).toMatch(/^bb_refresh=refresh-token-3;/);
      expect(cookie(res, 'bb_oauth')).toMatch(/Expires=Thu, 01 Jan 1970/);

      const sent = identity.callsTo(IdentityRpc.googleExchange)[0].message
        .data as {
        code: string;
        codeVerifier: string;
        nonce: string;
        redirectUri: string;
        iss?: string;
      };
      expect(sent.code).toBe('google-code');
      // Passed through for Identity to check (RFC 9207).
      expect(sent.iss).toBe('https://accounts.google.com');
      expect(sent.redirectUri).toBe(GOOGLE_REDIRECT);
      expect(sent.nonce).toBe(location.searchParams.get('nonce'));
      expect(
        createHash('sha256').update(sent.codeVerifier).digest('base64url'),
      ).toBe(location.searchParams.get('code_challenge'));
    });

    it.each([
      ['a state mismatch', { state: 'forged' }, true, 'OAUTH_EXCHANGE_FAILED'],
      ['no state cookie', {}, false, 'OAUTH_EXCHANGE_FAILED'],
      ['a denied consent', { error: 'access_denied' }, true, 'OAUTH_CANCELLED'],
      ['a missing code', { code: undefined }, true, 'OAUTH_EXCHANGE_FAILED'],
      [
        'a repeated iss',
        { iss: ['https://accounts.google.com', 'https://evil.example'] },
        true,
        'OAUTH_EXCHANGE_FAILED',
      ],
    ])(
      'returns to the web app with an error on %s, without calling Identity',
      async (_, override, withCookie, error) => {
        const { location, cookiePair } = await start();
        const query = {
          code: 'google-code',
          state: location.searchParams.get('state'),
          ...override,
        };
        const req = http()
          .get('/api/auth/google/callback')
          .query(
            Object.fromEntries(
              Object.entries(query).filter(([, v]) => v !== undefined),
            ),
          );
        const res = await (
          withCookie ? req.set('Cookie', cookiePair) : req
        ).expect(302);
        expect(res.headers['location']).toBe(
          `${WEB}/auth/callback?error=${error}`,
        );
        expect(identity.calls).toHaveLength(0);
        expect(cookie(res, 'bb_refresh')).toBeUndefined();
      },
    );

    it('rejects a tampered state cookie', async () => {
      const { location, cookiePair } = await start();
      const tampered = cookiePair.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
      const res = await http()
        .get('/api/auth/google/callback')
        .query({ code: 'c', state: location.searchParams.get('state') })
        .set('Cookie', tampered)
        .expect(302);
      expect(res.headers['location']).toBe(
        `${WEB}/auth/callback?error=OAUTH_EXCHANGE_FAILED`,
      );
      expect(identity.calls).toHaveLength(0);
    });

    it('passes Identity’s OAuth error code through to the web app', async () => {
      identity.fail(IdentityRpc.googleExchange, {
        code: 'OAUTH_EMAIL_NOT_VERIFIED',
        message: 'Your Google account email is not verified',
      });
      const { location, cookiePair } = await start();
      const res = await http()
        .get('/api/auth/google/callback')
        .query({ code: 'c', state: location.searchParams.get('state') })
        .set('Cookie', cookiePair)
        .expect(302);
      expect(res.headers['location']).toBe(
        `${WEB}/auth/callback?error=OAUTH_EMAIL_NOT_VERIFIED`,
      );
    });
  });

  it('committed openapi.json matches the code (run `npx nx run gateway:openapi`)', async () => {
    const { buildOpenApiDocument, serializeOpenApi } =
      await import('./bootstrap');
    const committed = readFileSync(
      join(__dirname, '../../openapi.json'),
      'utf8',
    );
    expect(serializeOpenApi(buildOpenApiDocument(app))).toBe(committed);
  });
});
