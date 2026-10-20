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
import { PasswordAuthModule } from './auth/password-auth.module';
import { validateConfig, type IdentityConfig } from './config';
import { IdentityDatabaseModule } from './database/database.module';
import { MeModule } from './users/me.module';
import { GoogleAuthModule } from './oauth/google-auth.module';

export const configModule = serviceConfigModule('identity', validateConfig);

@Module({
  imports: [
    configModule,
    IdentityDatabaseModule,
    EventsModule,
    AuthModule.forRoot({
      inject: [ConfigService],
      useFactory: (config: ConfigService<IdentityConfig, true>) => ({
        publicKeyPem: pemFromEnv(
          config.get('JWT_PUBLIC_KEY', { infer: true }),
          'JWT_PUBLIC_KEY',
        ),
        keyId: config.get('JWT_KEY_ID', { infer: true }),
      }),
    }),
    PasswordAuthModule,
    MeModule,
    GoogleAuthModule,
  ],
  providers: [
    { provide: APP_PIPE, useValue: rpcValidationPipe },
    { provide: APP_FILTER, useClass: RpcErrorFilter },
  ],
})
export class AppModule {}

/** `node main.js migrate`: only config + database, no broker or TCP listener. */
@Module({ imports: [configModule, IdentityDatabaseModule] })
export class MigrateModule {}
