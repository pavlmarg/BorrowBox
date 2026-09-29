import * as path from 'node:path';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { POSTGRES_IMAGE } from './images';

/** Every service that owns a schema + role (see infra/postgres/init). */
export const SERVICES = [
  'identity',
  'catalog',
  'bookings',
  'payments',
  'messaging',
  'notifications',
  'reviews',
] as const;
export type ServiceName = (typeof SERVICES)[number];

const DATABASE = 'borrowbox';
const ADMIN_USER = 'borrowbox_admin';
const ADMIN_PASSWORD = 'admin-test-password';
const INIT_SCRIPT = path.resolve(
  __dirname,
  '../../../../infra/postgres/init/20-service-schemas.sh',
);

const passwordFor = (service: ServiceName) => `${service}-test-password`;

export interface TestPostgres {
  container: StartedPostgreSqlContainer;
  /** Superuser connection — only for test setup/assertions, never for code under test. */
  adminUrl: string;
  /** Connection as the service's own role, restricted to its schema like in dev/prod. */
  urlFor(service: ServiceName): string;
  stop(): Promise<void>;
}

/**
 * Starts PostGIS with the real infra init script, so every test runs against the
 * same schema-per-service roles and permissions as `docker compose` (ADR-0002).
 */
export async function startPostgres(): Promise<TestPostgres> {
  const passwords = Object.fromEntries(
    SERVICES.map((s) => [`${s.toUpperCase()}_DB_PASSWORD`, passwordFor(s)]),
  );

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(DATABASE)
    .withUsername(ADMIN_USER)
    .withPassword(ADMIN_PASSWORD)
    .withEnvironment(passwords)
    .withCopyFilesToContainer([
      {
        source: INIT_SCRIPT,
        target: '/docker-entrypoint-initdb.d/20-service-schemas.sh',
        mode: 0o755,
      },
    ])
    .start();

  const host = container.getHost();
  const port = container.getPort();
  const url = (user: string, password: string) =>
    `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${DATABASE}`;

  return {
    container,
    adminUrl: url(ADMIN_USER, ADMIN_PASSWORD),
    urlFor: (service) => url(`${service}_svc`, passwordFor(service)),
    stop: async () => {
      await container.stop();
    },
  };
}
