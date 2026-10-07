import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IdentityRpc } from '@borrowbox/contracts';
import { FakeIdentity } from '../testing/fake-service';

/** A local port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * Separate file from gateway.spec.ts: ConfigModule validates env once per
 * module registry, and this gateway needs a Redis that is down.
 */
describe('Gateway rate limits while Redis is down', () => {
  let identity: FakeIdentity;
  let app: NestExpressApplication;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    identity = new FakeIdentity();
    await identity.start();
    const { publicKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    Object.assign(process.env, {
      REDIS_URL: `redis://:unused@127.0.0.1:${await closedPort()}`,
      IDENTITY_HOST: '127.0.0.1',
      IDENTITY_PORT: String(identity.port),
      RPC_TIMEOUT_MS: '1000',
      COOKIE_SECRET: 'test-cookie-secret-0123456789abcdef',
      JWT_PUBLIC_KEY: publicKey,
      JWT_KEY_ID: 'test-key',
      API_DOCS: 'false',
    });
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
  });

  afterAll(async () => {
    await app?.close();
    await identity?.stop();
    process.env = savedEnv;
  });

  it('keeps answering and still limits login to 10 per minute (in memory)', async () => {
    identity.fail(IdentityRpc.login, {
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    const login = () =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'ana@example.com', password: 'guess' });

    for (let i = 0; i < 10; i++) await login().expect(401);
    expect((await login().expect(429)).body.code).toBe('RATE_LIMITED');
    expect(identity.callsTo(IdentityRpc.login)).toHaveLength(10);
  });
});
