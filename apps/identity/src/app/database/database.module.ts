import type { DataSource } from 'typeorm';
import { CreateOutboxTables1759140000000 } from '@borrowbox/outbox';
import {
  DatabaseModule,
  createServiceDataSource,
} from '@borrowbox/service-kit';
import { IdentityInitial1759300000000 } from './migrations/1759300000000-identity-initial';
import { IdentityEmailTokens1761000000000 } from './migrations/1761000000000-identity-email-tokens';

export const MIGRATIONS = [
  CreateOutboxTables1759140000000,
  IdentityInitial1759300000000,
  IdentityEmailTokens1761000000000,
];

export function createIdentityDataSource(url: string): DataSource {
  return createServiceDataSource(url, MIGRATIONS);
}

/** Identity's DataSource as `DATA_SOURCE` (from `@borrowbox/service-kit`). */
export const IdentityDatabaseModule = DatabaseModule.forRoot(MIGRATIONS);
