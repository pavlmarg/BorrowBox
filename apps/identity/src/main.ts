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
import type { IdentityConfig } from './app/config';
import { DATA_SOURCE, runMigrations } from './app/database/database.module';

/** `nx run identity:migrate` (production): apply pending migrations and exit. */
async function migrate(): Promise<void> {
  const app = await NestFactory.createApplicationContext(MigrateModule);
  const ran = await runMigrations(app.get<DataSource>(DATA_SOURCE));
  Logger.log(`${ran} migration(s) applied`, 'Migrate');
  await app.close();
}

/** Gateway → Identity over NestJS TCP (ADR-0005). */
async function serve(): Promise<void> {
  const app = await NestFactory.createMicroservice<AsyncMicroserviceOptions>(
    AppModule,
    {
      inject: [ConfigService],
      useFactory: (config: ConfigService<IdentityConfig, true>) => ({
        transport: Transport.TCP,
        options: {
          host: config.get('IDENTITY_HOST', { infer: true }),
          port: config.get('IDENTITY_PORT', { infer: true }),
        },
      }),
    },
  );
  app.enableShutdownHooks();
  await app.listen();
  const config = app.get(ConfigService<IdentityConfig, true>);
  Logger.log(
    `Identity listening on tcp://${config.get('IDENTITY_HOST', { infer: true })}:${config.get('IDENTITY_PORT', { infer: true })}`,
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
