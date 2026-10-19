// Test-only (excluded from the app build): boots Catalog as a real TCP
// microservice against the given Postgres/RabbitMQ and talks to it the way the
// gateway will, through a ClientProxy.
import { randomUUID } from 'node:crypto';
import { createAccessTokenSigner } from '@borrowbox/auth';
import type { CatalogRpcContract } from '@borrowbox/contracts';
import {
  freePort,
  generateTestKeys,
  startServiceHarness,
  type ServiceHarness,
  type TestKeys,
} from '@borrowbox/service-kit/testing';

/** The storage settings Catalog needs (a `TestS3` from @borrowbox/testing fits). */
export interface HarnessStorage {
  endpoint: string;
  region: string;
  uploadsBucket: string;
  publicBucket: string;
  catalog: { accessKeyId: string; secretAccessKey: string };
}

/** What photo URLs start with in tests. */
export const TEST_PHOTOS_BASE_URL = 'https://photos.test/borrowbox-public';

export interface CatalogHarness extends ServiceHarness<CatalogRpcContract> {
  keys: TestKeys;
  /** A valid access token for `userId`, signed as Identity would. */
  tokenFor(userId: string): Promise<string>;
}

export async function startCatalog(urls: {
  databaseUrl: string;
  rabbitmqUrl: string;
  redisUrl: string;
  /**
   * Real storage, for photo tests. Without it, storage points at a closed
   * port, so any accidental use fails fast.
   */
  s3?: HarnessStorage;
}): Promise<CatalogHarness> {
  const keys = generateTestKeys();
  const port = await freePort();
  const harness = await startServiceHarness<CatalogRpcContract>({
    port,
    env: {
      DATABASE_URL: urls.databaseUrl,
      RABBITMQ_URL: urls.rabbitmqUrl,
      CATALOG_HOST: '127.0.0.1',
      CATALOG_PORT: String(port),
      DB_MIGRATIONS_RUN: 'true',
      // Catalog only gets the public key; tests sign tokens with
      // `keys.privateKeyPem`, playing Identity's part.
      JWT_PUBLIC_KEY: keys.publicKeyPem,
      JWT_KEY_ID: keys.keyId,
      PHOTOS_BASE_URL: urls.s3
        ? `${urls.s3.endpoint}/${urls.s3.publicBucket}`
        : TEST_PHOTOS_BASE_URL,
      REDIS_URL: urls.redisUrl,
      S3_ENDPOINT: urls.s3?.endpoint ?? 'http://127.0.0.1:9',
      S3_REGION: urls.s3?.region ?? 'us-east-1',
      S3_ACCESS_KEY_ID: urls.s3?.catalog.accessKeyId ?? 'unused',
      S3_SECRET_ACCESS_KEY: urls.s3?.catalog.secretAccessKey ?? 'unused',
      S3_UPLOADS_BUCKET: urls.s3?.uploadsBucket ?? 'unused-uploads',
      S3_PUBLIC_BUCKET: urls.s3?.publicBucket ?? 'unused-public',
    },
    loadAppModule: async () => (await import('../app/app.module')).AppModule,
  });

  const signer = await createAccessTokenSigner({
    privateKeyPem: keys.privateKeyPem,
    keyId: keys.keyId,
  });

  return {
    ...harness,
    keys,
    tokenFor: async (userId) =>
      (await signer.sign({ userId, sessionId: randomUUID() })).token,
  };
}
