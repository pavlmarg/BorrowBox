import * as path from 'node:path';
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from 'testcontainers';
import { AWS_CLI_IMAGE, SEAWEEDFS_IMAGE, STARTUP_TIMEOUT_MS } from './images';

const STORAGE_DIR = path.resolve(__dirname, '../../../../infra/storage');

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface TestS3 {
  container: StartedTestContainer;
  /** S3 API base URL, e.g. `http://localhost:49153`. Use path-style requests. */
  endpoint: string;
  region: string;
  uploadsBucket: string;
  publicBucket: string;
  /** The only browser origin the uploads bucket's CORS rule allows. */
  corsOrigin: string;
  /** Full rights — only for test setup/assertions, never for code under test. */
  admin: S3Credentials;
  /** Read/write on the two buckets only, like Catalog's key in dev/prod. */
  catalog: S3Credentials;
  /** Public URL of an object in the public bucket. */
  publicUrl(key: string): string;
  stop(): Promise<void>;
}

/**
 * SeaweedFS set up exactly like `docker compose` (ADR-0009): started with
 * infra/storage/seaweedfs.sh, then infra/storage/init.sh runs once in the
 * AWS CLI image to create the buckets, the upload CORS rule and the expiry.
 */
export async function startS3(): Promise<TestS3> {
  const env = {
    S3_ADMIN_ACCESS_KEY_ID: 'test-admin',
    S3_ADMIN_SECRET_ACCESS_KEY: 'test-admin-secret',
    S3_CATALOG_ACCESS_KEY_ID: 'test-catalog',
    S3_CATALOG_SECRET_ACCESS_KEY: 'test-catalog-secret',
    S3_UPLOADS_BUCKET: 'borrowbox-uploads',
    S3_PUBLIC_BUCKET: 'borrowbox-public',
  };
  const corsOrigin = 'http://localhost:4200';
  const region = 'us-east-1';

  const network: StartedNetwork = await new Network().start();
  let container: StartedTestContainer | undefined;
  try {
    container = await new GenericContainer(SEAWEEDFS_IMAGE)
      .withNetwork(network)
      .withEnvironment(env)
      .withCopyFilesToContainer([
        {
          source: path.join(STORAGE_DIR, 'seaweedfs.sh'),
          target: '/storage/seaweedfs.sh',
          mode: 0o755,
        },
      ])
      .withEntrypoint(['/bin/sh', '/storage/seaweedfs.sh'])
      .withExposedPorts(8333)
      // Same check as the compose healthcheck: any HTTP answer from the S3
      // API means it's up (curl fails only when nothing is listening).
      .withWaitStrategy(
        Wait.forSuccessfulCommand(
          'curl -s -o /dev/null http://127.0.0.1:8333/',
        ),
      )
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start();

    const init = await new GenericContainer(AWS_CLI_IMAGE)
      .withNetwork(network)
      .withEnvironment({
        // By IP: network-alias DNS isn't reliable on every Docker setup.
        S3_ENDPOINT: `http://${container.getIpAddress(network.getName())}:8333`,
        AWS_ACCESS_KEY_ID: env.S3_ADMIN_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: env.S3_ADMIN_SECRET_ACCESS_KEY,
        AWS_DEFAULT_REGION: region,
        S3_UPLOADS_BUCKET: env.S3_UPLOADS_BUCKET,
        S3_PUBLIC_BUCKET: env.S3_PUBLIC_BUCKET,
        S3_CORS_ORIGINS: corsOrigin,
      })
      .withCopyFilesToContainer([
        {
          source: path.join(STORAGE_DIR, 'init.sh'),
          target: '/storage/init.sh',
          mode: 0o755,
        },
      ])
      // Kept idle, so the script runs through exec() with a real exit code.
      .withEntrypoint(['/bin/sh', '-c', 'sleep 600'])
      .withStartupTimeout(STARTUP_TIMEOUT_MS)
      .start();
    try {
      const { exitCode, output } = await init.exec([
        '/bin/sh',
        '/storage/init.sh',
      ]);
      if (exitCode !== 0) {
        throw new Error(
          `infra/storage/init.sh failed (${exitCode}):\n${output}`,
        );
      }
    } finally {
      await init.stop();
    }
  } catch (err) {
    await container?.stop();
    await network.stop();
    throw err;
  }

  const started = container;
  const endpoint = `http://${started.getHost()}:${started.getMappedPort(8333)}`;
  return {
    container: started,
    endpoint,
    region,
    uploadsBucket: env.S3_UPLOADS_BUCKET,
    publicBucket: env.S3_PUBLIC_BUCKET,
    corsOrigin,
    admin: {
      accessKeyId: env.S3_ADMIN_ACCESS_KEY_ID,
      secretAccessKey: env.S3_ADMIN_SECRET_ACCESS_KEY,
    },
    catalog: {
      accessKeyId: env.S3_CATALOG_ACCESS_KEY_ID,
      secretAccessKey: env.S3_CATALOG_SECRET_ACCESS_KEY,
    },
    publicUrl: (key) => `${endpoint}/${env.S3_PUBLIC_BUCKET}/${key}`,
    stop: async () => {
      await started.stop();
      await network.stop();
    },
  };
}
