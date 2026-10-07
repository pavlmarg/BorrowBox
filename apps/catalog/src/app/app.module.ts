import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule, pemFromEnv } from '@borrowbox/auth';
import { validateConfig, type CatalogConfig } from './config';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { ItemsModule } from './items/items.module';
import { LendersModule } from './lenders/lenders.module';
import { SearchModule } from './search/search.module';
import { CatalogRpcExceptionFilter, rpcValidationPipe } from './rpc/rpc-errors';

/** Dev reads `apps/catalog/.env` (gitignored); elsewhere env comes from the environment. */
export const configModule = ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: join(process.cwd(), 'apps/catalog/.env'),
  // Tests set their own env; a developer's local .env must not leak in.
  ignoreEnvFile: process.env['NODE_ENV'] === 'test',
  validate: validateConfig,
  cache: true,
});

@Module({
  imports: [
    configModule,
    DatabaseModule,
    EventsModule,
    AuthModule.forRoot({
      inject: [ConfigService],
      useFactory: (config: ConfigService<CatalogConfig, true>) => ({
        publicKeyPem: pemFromEnv(
          config.get('JWT_PUBLIC_KEY', { infer: true }),
          'JWT_PUBLIC_KEY',
        ),
        keyId: config.get('JWT_KEY_ID', { infer: true }),
      }),
    }),
    LendersModule,
    ItemsModule,
    SearchModule,
  ],
  providers: [
    { provide: APP_PIPE, useValue: rpcValidationPipe },
    { provide: APP_FILTER, useClass: CatalogRpcExceptionFilter },
  ],
})
export class AppModule {}

/** `node main.js migrate`: only config + database, no broker or TCP listener. */
@Module({ imports: [configModule, DatabaseModule] })
export class MigrateModule {}
