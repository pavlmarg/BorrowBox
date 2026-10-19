import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AuthModule, pemFromEnv } from '@borrowbox/auth';
import {
  EventsModule,
  RpcErrorFilter,
  rpcValidationPipe,
  serviceConfigModule,
} from '@borrowbox/service-kit';
import { validateConfig, type CatalogConfig } from './config';
import { CatalogDatabaseModule } from './database/database.module';
import { ItemsModule } from './items/items.module';
import { LendersModule } from './lenders/lenders.module';
import { PhotosModule } from './photos/photos.module';
import { SearchModule } from './search/search.module';

export const configModule = serviceConfigModule('catalog', validateConfig);

@Module({
  imports: [
    configModule,
    CatalogDatabaseModule,
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
    PhotosModule,
    LendersModule,
    ItemsModule,
    SearchModule,
  ],
  providers: [
    { provide: APP_PIPE, useValue: rpcValidationPipe },
    { provide: APP_FILTER, useClass: RpcErrorFilter },
  ],
})
export class AppModule {}

/** `node main.js migrate`: only config + database, no broker or TCP listener. */
@Module({ imports: [configModule, CatalogDatabaseModule] })
export class MigrateModule {}
