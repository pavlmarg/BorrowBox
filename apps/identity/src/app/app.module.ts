import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule, pemFromEnv } from '@borrowbox/auth';
import { PasswordAuthModule } from './auth/password-auth.module';
import { validateConfig, type IdentityConfig } from './config';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { MeModule } from './users/me.module';
import {
  IdentityRpcExceptionFilter,
  rpcValidationPipe,
} from './rpc/rpc-errors';

/** Dev reads `apps/identity/.env` (gitignored); elsewhere env comes from the environment. */
export const configModule = ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: join(process.cwd(), 'apps/identity/.env'),
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
  ],
  providers: [
    { provide: APP_PIPE, useValue: rpcValidationPipe },
    { provide: APP_FILTER, useClass: IdentityRpcExceptionFilter },
  ],
})
export class AppModule {}

/** `node main.js migrate`: only config + database, no broker or TCP listener. */
@Module({ imports: [configModule, DatabaseModule] })
export class MigrateModule {}
