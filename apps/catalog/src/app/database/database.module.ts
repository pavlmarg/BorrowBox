import type { DataSource } from 'typeorm';
import { CreateOutboxTables1759140000000 } from '@borrowbox/outbox';
import {
  DatabaseModule,
  createServiceDataSource,
} from '@borrowbox/service-kit';
import { CatalogInitial1759800000000 } from './migrations/1759800000000-catalog-initial';
import { CatalogPhotoPipeline1759900000000 } from './migrations/1759900000000-catalog-photo-pipeline';

export const MIGRATIONS = [
  CreateOutboxTables1759140000000,
  CatalogInitial1759800000000,
  CatalogPhotoPipeline1759900000000,
];

export function createCatalogDataSource(url: string): DataSource {
  return createServiceDataSource(url, MIGRATIONS);
}

/** Catalog's DataSource as `DATA_SOURCE` (from `@borrowbox/service-kit`). */
export const CatalogDatabaseModule = DatabaseModule.forRoot(MIGRATIONS);
