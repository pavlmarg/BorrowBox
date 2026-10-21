import { Logger, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  Transport,
  type AsyncMicroserviceOptions,
} from '@nestjs/microservices';
import type { DataSource } from 'typeorm';
import { DATA_SOURCE, runMigrations } from './database';

export interface ServiceBootstrapOptions {
  /** For logs, e.g. `Catalog`. */
  name: string;
  appModule: Type;
  /** Only config + database, no broker or TCP listener. */
  migrateModule: Type;
  /** Config keys of the TCP bind address, e.g. `CATALOG_HOST` / `CATALOG_PORT`. */
  hostKey: string;
  portKey: string;
  /**
   * One-off commands, e.g. `republish-items`: `node main.js <name>` runs it
   * with only config + database (`migrateModule`), logs its summary and exits.
   */
  tasks?: Record<string, (dataSource: DataSource) => Promise<string>>;
}

/**
 * A service's `main.ts`: `node main.js migrate` (production, `nx run <app>:migrate`)
 * applies pending migrations and exits; `node main.js <task>` runs one of
 * `tasks`; otherwise it serves the gateway over NestJS TCP (ADR-0005).
 */
export function runService(options: ServiceBootstrapOptions): void {
  const command = process.argv[2];
  const task = command ? options.tasks?.[command] : undefined;
  const run =
    command === undefined
      ? serve
      : command === 'migrate'
        ? migrate
        : task
          ? (o: ServiceBootstrapOptions) => runTask(o, command, task)
          : () => Promise.reject(new Error(`Unknown command "${command}"`));
  run(options).catch((err: unknown) => {
    Logger.error(
      err instanceof Error ? err.message : String(err),
      undefined,
      'Bootstrap',
    );
    process.exit(1);
  });
}

async function migrate({
  migrateModule,
}: ServiceBootstrapOptions): Promise<void> {
  const app = await NestFactory.createApplicationContext(migrateModule);
  const ran = await runMigrations(app.get<DataSource>(DATA_SOURCE));
  Logger.log(`${ran} migration(s) applied`, 'Migrate');
  await app.close();
}

async function runTask(
  { migrateModule }: ServiceBootstrapOptions,
  name: string,
  task: (dataSource: DataSource) => Promise<string>,
): Promise<void> {
  const app = await NestFactory.createApplicationContext(migrateModule);
  try {
    Logger.log(await task(app.get<DataSource>(DATA_SOURCE)), name);
  } finally {
    await app.close();
  }
}

async function serve({
  name,
  appModule,
  hostKey,
  portKey,
}: ServiceBootstrapOptions): Promise<void> {
  const app = await NestFactory.createMicroservice<AsyncMicroserviceOptions>(
    appModule,
    {
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: Transport.TCP,
        options: {
          host: config.getOrThrow<string>(hostKey),
          port: config.getOrThrow<number>(portKey),
        },
      }),
    },
  );
  app.enableShutdownHooks();
  await app.listen();
  const config = app.get(ConfigService);
  Logger.log(
    `${name} listening on tcp://${config.getOrThrow<string>(hostKey)}:${config.getOrThrow<number>(portKey)}`,
    'Bootstrap',
  );
}
