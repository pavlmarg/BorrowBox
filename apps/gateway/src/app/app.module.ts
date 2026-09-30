import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type Redis from 'ioredis';
import { AuthModule, pemFromEnv } from '@borrowbox/auth';
import { AuthController } from './auth/auth.controller';
import { validateConfig, type GatewayConfig } from './config';
import { HealthController } from './health.controller';
import { DEFAULT_LIMIT } from './http/rate-limits';
import {
  IDENTITY_PROXY,
  IdentityClient,
  RPC_TIMEOUT_MS,
} from './identity/identity.client';
import { MeController } from './me/me.controller';
import { REDIS, RedisModule } from './redis.module';

/** Dev reads `apps/gateway/.env` (gitignored); elsewhere env comes from the environment. */
const configModule = ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: join(process.cwd(), 'apps/gateway/.env'),
  // Tests set their own env; a developer's local .env must not leak in.
  ignoreEnvFile: process.env['NODE_ENV'] === 'test',
  validate: validateConfig,
  cache: true,
});

/** Stateless API gateway / BFF: owns no data (ARCHITECTURE.md §2). */
@Module({
  imports: [
    configModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ...DEFAULT_LIMIT }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    AuthModule.forRoot({
      inject: [ConfigService],
      useFactory: (config: ConfigService<GatewayConfig, true>) => ({
        publicKeyPem: pemFromEnv(
          config.get('JWT_PUBLIC_KEY', { infer: true }),
          'JWT_PUBLIC_KEY',
        ),
        keyId: config.get('JWT_KEY_ID', { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController, MeController, HealthController],
  providers: [
    {
      provide: IDENTITY_PROXY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<GatewayConfig, true>) =>
        ClientProxyFactory.create({
          transport: Transport.TCP,
          options: {
            host: config.get('IDENTITY_HOST', { infer: true }),
            port: config.get('IDENTITY_PORT', { infer: true }),
          },
        }),
    },
    {
      provide: RPC_TIMEOUT_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<GatewayConfig, true>) =>
        config.get('RPC_TIMEOUT_MS', { infer: true }),
    },
    IdentityClient,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
