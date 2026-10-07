import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  Transport,
  type AsyncMicroserviceOptions,
} from '@nestjs/microservices';
import type { DataSource } from 'typeorm';
import { AppModule, MigrateModule } from './app/app.module';
import type { CatalogConfig } from './app/config';
import { DATA_SOURCE, runMigrations } from './app/database/database.module';

/** `nx run catalog:migrate` (production): apply pending migrations and exit. */
async function migrate(): Promise<void> {
  const app = await NestFactory.createApplicationContext(MigrateModule);
  const ran = await runMigrations(app.get<DataSource>(DATA_SOURCE));
  Logger.log(`${ran} migration(s) applied`, 'Migrate');
  await app.close();
}

/** Gateway → Catalog over NestJS TCP (ADR-0005). */
async function serve(): Promise<void> {
  const app = await NestFactory.createMicroservice<AsyncMicroserviceOptions>(
    AppModule,
    {
      inject: [ConfigService],
      useFactory: (config: ConfigService<CatalogConfig, true>) => ({
        transport: Transport.TCP,
        options: {
          host: config.get('CATALOG_HOST', { infer: true }),
          port: config.get('CATALOG_PORT', { infer: true }),
        },
      }),
    },
  );
  app.enableShutdownHooks();
  await app.listen();
  const config = app.get(ConfigService<CatalogConfig, true>);
  Logger.log(
    `Catalog listening on tcp://${config.get('CATALOG_HOST', { infer: true })}:${config.get('CATALOG_PORT', { infer: true })}`,
    'Bootstrap',
  );
}

const run = process.argv[2] === 'migrate' ? migrate : serve;
run().catch((err: unknown) => {
  Logger.error(
    err instanceof Error ? err.message : String(err),
    undefined,
    'Bootstrap',
  );
  process.exit(1);
});
