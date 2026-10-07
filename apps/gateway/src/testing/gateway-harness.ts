// Test-only (excluded from the app build): boots the real gateway (HTTP,
// guards, pipes, filters, rate limits) against fake services and a real Redis.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  createAccessTokenSigner,
  type AccessTokenSigner,
} from '@borrowbox/auth';

export interface GatewayHarness {
  app: NestExpressApplication;
  http(): ReturnType<typeof request>;
  /** `Bearer <valid access token>` for `userId`. */
  bearer(userId?: string): Promise<string>;
  /** Signed with a key the gateway doesn't trust. */
  forgedBearer(userId?: string): Promise<string>;
  close(): Promise<void>;
}

export async function startGateway(options: {
  redisUrl: string;
  identityPort: number;
  catalogPort: number;
  rpcTimeoutMs?: number;
}): Promise<GatewayHarness> {
  const keys = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const otherKeys = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const signer = await createAccessTokenSigner({
    privateKeyPem: keys.privateKey,
    keyId: 'test-key',
  });
  const forger: AccessTokenSigner = await createAccessTokenSigner({
    privateKeyPem: otherKeys.privateKey,
    keyId: 'test-key',
  });

  Object.assign(process.env, {
    REDIS_URL: options.redisUrl,
    IDENTITY_HOST: '127.0.0.1',
    IDENTITY_PORT: String(options.identityPort),
    CATALOG_HOST: '127.0.0.1',
    CATALOG_PORT: String(options.catalogPort),
    RPC_TIMEOUT_MS: String(options.rpcTimeoutMs ?? 1000),
    COOKIE_SECRET: 'test-cookie-secret-0123456789abcdef',
    JWT_PUBLIC_KEY: keys.publicKey,
    JWT_KEY_ID: 'test-key',
    CORS_ORIGINS: 'http://localhost:4200',
    WEB_APP_URL: 'http://localhost:4200',
    API_DOCS: 'false',
  });
  // ConfigModule.forRoot validates env when app.module is first imported.
  const { AppModule } = await import('../app/app.module');
  const { configureApp } = await import('../app/bootstrap');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app);
  await app.init();

  const bearerWith =
    (s: AccessTokenSigner) =>
    async (userId: string = randomUUID()) =>
      `Bearer ${(await s.sign({ userId, sessionId: randomUUID() })).token}`;

  return {
    app,
    http: () => request(app.getHttpServer()),
    bearer: bearerWith(signer),
    forgedBearer: bearerWith(forger),
    close: () => app.close(),
  };
}
