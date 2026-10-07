// Test-only (excluded from the app build): boots Catalog as a real TCP
// microservice against the given Postgres/RabbitMQ and talks to it the way the
// gateway will, through a ClientProxy.
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { INestMicroservice } from '@nestjs/common';
import {
  ClientProxyFactory,
  Transport,
  type ClientProxy,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { lastValueFrom } from 'rxjs';
import type { DataSource } from 'typeorm';
import { createAccessTokenSigner } from '@borrowbox/auth';
import type {
  CatalogRpcContract,
  CatalogRpcPattern,
  RpcRequest,
} from '@borrowbox/contracts';
import { DATA_SOURCE } from '../app/database/database.module';

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

export interface CatalogHarness {
  app: INestMicroservice;
  dataSource: DataSource;
  keys: { publicKeyPem: string; privateKeyPem: string; keyId: string };
  /** A valid access token for `userId`, signed as Identity would. */
  tokenFor(userId: string): Promise<string>;
  /** Resolves with the response, rejects with the `RpcErrorBody`. */
  send<P extends CatalogRpcPattern>(
    pattern: P,
    data: unknown,
    options?: { accessToken?: string; correlationId?: string },
  ): Promise<CatalogRpcContract[P]['response']>;
  close(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });
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
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const keys = {
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    keyId: 'test-key',
  };
  const port = await freePort();
  Object.assign(process.env, {
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
  });

  // ConfigModule.forRoot validates env when app.module is first imported,
  // so import it only after process.env is populated.
  const { AppModule } = await import('../app/app.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestMicroservice({
    transport: Transport.TCP,
    options: { host: '127.0.0.1', port },
  });
  await app.listen();

  const client: ClientProxy = ClientProxyFactory.create({
    transport: Transport.TCP,
    options: { host: '127.0.0.1', port },
  });
  await client.connect();

  const signer = await createAccessTokenSigner({
    privateKeyPem: keys.privateKeyPem,
    keyId: keys.keyId,
  });

  return {
    app,
    dataSource: app.get<DataSource>(DATA_SOURCE),
    keys,
    tokenFor: async (userId) =>
      (await signer.sign({ userId, sessionId: randomUUID() })).token,
    send: (pattern, data, options = {}) => {
      const message: RpcRequest<unknown> = {
        correlationId: options.correlationId ?? 'test-correlation',
        ...(options.accessToken ? { accessToken: options.accessToken } : {}),
        data,
      };
      // void handlers complete without a value.
      return lastValueFrom(client.send(pattern, message), {
        defaultValue: undefined,
      });
    },
    close: async () => {
      await client.close();
      await app.close();
    },
  };
}
