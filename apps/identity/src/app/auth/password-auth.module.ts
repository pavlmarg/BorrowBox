import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAccessTokenSigner, pemFromEnv } from '@borrowbox/auth';
import type { IdentityConfig } from '../config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password-hasher';
import { ACCESS_TOKEN_SIGNER, SessionService } from './session.service';

/** Email + password: register, login, refresh, logout. */
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: ACCESS_TOKEN_SIGNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<IdentityConfig, true>) =>
        createAccessTokenSigner({
          privateKeyPem: pemFromEnv(
            config.get('JWT_PRIVATE_KEY', { infer: true }),
            'JWT_PRIVATE_KEY',
          ),
          keyId: config.get('JWT_KEY_ID', { infer: true }),
        }),
    },
    PasswordHasher,
    SessionService,
    AuthService,
  ],
  exports: [SessionService, PasswordHasher],
})
export class PasswordAuthModule {}
