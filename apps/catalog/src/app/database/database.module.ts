import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { CreateOutboxTables1759140000000 } from '@borrowbox/outbox';
import type { CatalogConfig } from '../config';

export const DATA_SOURCE = Symbol('DATA_SOURCE');

export const MIGRATIONS = [CreateOutboxTables1759140000000];

export function createCatalogDataSource(url: string): DataSource {
  return new DataSource({
    type: 'postgres',
    url,
    migrations: MIGRATIONS,
    // Schema changes only ever come from migrations.
    synchronize: false,
    migrationsTransactionMode: 'each',
  });
}

/** Runs pending migrations and returns how many ran. */
export async function runMigrations(dataSource: DataSource): Promise<number> {
  const ran = await dataSource.runMigrations();
  for (const m of ran) Logger.log(`Migrated ${m.name}`, 'Database');
  return ran.length;
}

@Global()
@Module({
  providers: [
    {
      provide: DATA_SOURCE,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<CatalogConfig, true>) => {
        const dataSource = createCatalogDataSource(
          config.get('DATABASE_URL', { infer: true }),
        );
        await dataSource.initialize();
        if (config.get('DB_MIGRATIONS_RUN', { infer: true })) {
          await runMigrations(dataSource);
        }
        return dataSource;
      },
    },
  ],
  exports: [DATA_SOURCE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }
}
