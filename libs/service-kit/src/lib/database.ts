import {
  Global,
  Inject,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type MigrationInterface } from 'typeorm';
import type { BaseServiceConfig } from './config';

export const DATA_SOURCE = Symbol('DATA_SOURCE');

export type MigrationClass = new () => MigrationInterface;

export function createServiceDataSource(
  url: string,
  migrations: MigrationClass[],
): DataSource {
  return new DataSource({
    type: 'postgres',
    url,
    migrations,
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

/** The service's DataSource as `DATA_SOURCE`, global. */
@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  static forRoot(migrations: MigrationClass[]): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DATA_SOURCE,
          inject: [ConfigService],
          useFactory: async (
            config: ConfigService<BaseServiceConfig, true>,
          ) => {
            const dataSource = createServiceDataSource(
              config.get('DATABASE_URL', { infer: true }),
              migrations,
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
    };
  }

  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }
}
