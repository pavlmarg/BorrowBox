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
import { BookingsModule } from './bookings/bookings.module';
import { validateConfig, type BookingsConfig } from './config';
import { BookingsDatabaseModule } from './database/database.module';
import { ExpiryModule } from './expiry/expiry.module';
import { MessagingModule } from './messaging/messaging.module';
import { ReadModelsModule } from './read-models/read-models.module';

export const configModule = serviceConfigModule('bookings', validateConfig);

@Module({
  imports: [
    configModule,
    BookingsDatabaseModule,
    EventsModule,
    AuthModule.forRoot({
      inject: [ConfigService],
      useFactory: (config: ConfigService<BookingsConfig, true>) => ({
        publicKeyPem: pemFromEnv(
          config.get('JWT_PUBLIC_KEY', { infer: true }),
          'JWT_PUBLIC_KEY',
        ),
        keyId: config.get('JWT_KEY_ID', { infer: true }),
      }),
    }),
    MessagingModule,
    ExpiryModule,
    ReadModelsModule,
    BookingsModule,
  ],
  providers: [
    { provide: APP_PIPE, useValue: rpcValidationPipe },
    { provide: APP_FILTER, useClass: RpcErrorFilter },
  ],
})
export class AppModule {}

/** `node main.js migrate`: only config + database, no broker or TCP listener. */
@Module({ imports: [configModule, BookingsDatabaseModule] })
export class MigrateModule {}
