// Test-only (excluded from the app build): boots Identity as a real TCP
// microservice against the given Postgres/RabbitMQ and talks to it the way the
// gateway will, through a ClientProxy.
import type { IdentityRpcContract } from '@borrowbox/contracts';
import {
  freePort,
  generateTestKeys,
  startServiceHarness,
  type ServiceHarness,
  type TestKeys,
} from '@borrowbox/service-kit/testing';

/** The storage settings Identity needs (a `TestS3` from @borrowbox/testing fits). */
export interface HarnessStorage {
  endpoint: string;
  region: string;
  uploadsBucket: string;
  publicBucket: string;
  identity: { accessKeyId: string; secretAccessKey: string };
}

/** What profile photo URLs start with in tests without real storage. */
export const TEST_PHOTOS_BASE_URL = 'https://photos.test/borrowbox-public';

export interface IdentityHarness extends ServiceHarness<IdentityRpcContract> {
  keys: TestKeys;
}

export async function startIdentity(urls: {
  databaseUrl: string;
  rabbitmqUrl: string;
  /** Photo jobs (BullMQ). */
  redisUrl: string;
  /**
   * Real storage, for photo tests. Without it, storage points at a closed
   * port, so any accidental use fails fast.
   */
  s3?: HarnessStorage;
  /** Extra env, e.g. GOOGLE_* pointing at a FakeOidcProvider. */
  env?: Record<string, string>;
}): Promise<IdentityHarness> {
  const keys = generateTestKeys();
  const port = await freePort();
  const harness = await startServiceHarness<IdentityRpcContract>({
    port,
    env: {
      DATABASE_URL: urls.databaseUrl,
      RABBITMQ_URL: urls.rabbitmqUrl,
      IDENTITY_HOST: '127.0.0.1',
      IDENTITY_PORT: String(port),
      DB_MIGRATIONS_RUN: 'true',
      JWT_PUBLIC_KEY: keys.publicKeyPem,
      JWT_PRIVATE_KEY: keys.privateKeyPem,
      JWT_KEY_ID: keys.keyId,
      PHOTOS_BASE_URL: urls.s3
        ? `${urls.s3.endpoint}/${urls.s3.publicBucket}`
        : TEST_PHOTOS_BASE_URL,
      REDIS_URL: urls.redisUrl,
      S3_ENDPOINT: urls.s3?.endpoint ?? 'http://127.0.0.1:9',
      S3_REGION: urls.s3?.region ?? 'us-east-1',
      S3_ACCESS_KEY_ID: urls.s3?.identity.accessKeyId ?? 'unused',
      S3_SECRET_ACCESS_KEY: urls.s3?.identity.secretAccessKey ?? 'unused',
      S3_UPLOADS_BUCKET: urls.s3?.uploadsBucket ?? 'unused-uploads',
      S3_PUBLIC_BUCKET: urls.s3?.publicBucket ?? 'unused-public',
      ...urls.env,
    },
    loadAppModule: async () => (await import('../app/app.module')).AppModule,
  });
  return { ...harness, keys };
}
