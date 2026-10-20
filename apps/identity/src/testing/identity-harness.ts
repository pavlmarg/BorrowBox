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

export interface IdentityHarness extends ServiceHarness<IdentityRpcContract> {
  keys: TestKeys;
}

export async function startIdentity(urls: {
  databaseUrl: string;
  rabbitmqUrl: string;
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
      ...urls.env,
    },
    loadAppModule: async () => (await import('../app/app.module')).AppModule,
  });
  return { ...harness, keys };
}
