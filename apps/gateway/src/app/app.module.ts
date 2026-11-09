import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModule,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type Redis from 'ioredis';
import { AuthModule, pemFromEnv } from '@borrowbox/auth';
import { AuthController } from './auth/auth.controller';
import {
  BookingsController,
  ItemBookingsController,
  MyBookingsController,
} from './bookings/bookings.controller';
import {
  BOOKINGS_PROXY,
  BookingsClient,
  MESSAGING_PROXY,
  MessagingClient,
} from './bookings/bookings.client';
import { validateConfig, type GatewayConfig } from './config';
import { CATALOG_PROXY, CatalogClient } from './catalog/catalog.client';
import { HealthController } from './health.controller';
import { FallbackThrottlerStorage } from './http/fallback-throttler-storage';
import { DEFAULT_LIMIT } from './http/rate-limits';
import { IDENTITY_PROXY, IdentityClient } from './identity/identity.client';
import { MyItemsController } from './items/my-items.controller';
import { PublicItemsController } from './items/public-items.controller';
import { MeController } from './me/me.controller';
import { ChatGateway } from './messaging/chat.gateway';
import { ConversationsController } from './messaging/conversations.controller';
import {
  NOTIFICATIONS_PROXY,
  NotificationsClient,
} from './notifications/notifications.client';
import {
  CheckoutController,
  PayoutsController,
  StripeWebhooksController,
} from './payments/payments.controller';
import { PAYMENTS_PROXY, PaymentsClient } from './payments/payments.client';
import { REDIS, RedisModule } from './redis.module';
import { rpcTimeoutProvider, tcpClientProvider } from './rpc/rpc.providers';

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
        storage: new FallbackThrottlerStorage(
          redis,
          new ThrottlerStorageRedisService(redis),
          new ThrottlerStorageService(),
        ),
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
  controllers: [
    AuthController,
    MeController,
    MyItemsController,
    PublicItemsController,
    ItemBookingsController,
    BookingsController,
    MyBookingsController,
    ConversationsController,
    CheckoutController,
    PayoutsController,
    StripeWebhooksController,
    HealthController,
  ],
  providers: [
    rpcTimeoutProvider,
    tcpClientProvider(IDENTITY_PROXY, 'IDENTITY_HOST', 'IDENTITY_PORT'),
    IdentityClient,
    tcpClientProvider(CATALOG_PROXY, 'CATALOG_HOST', 'CATALOG_PORT'),
    CatalogClient,
    tcpClientProvider(BOOKINGS_PROXY, 'BOOKINGS_HOST', 'BOOKINGS_PORT'),
    BookingsClient,
    tcpClientProvider(MESSAGING_PROXY, 'BOOKINGS_HOST', 'BOOKINGS_PORT'),
    MessagingClient,
    tcpClientProvider(
      NOTIFICATIONS_PROXY,
      'NOTIFICATIONS_HOST',
      'NOTIFICATIONS_PORT',
    ),
    NotificationsClient,
    tcpClientProvider(PAYMENTS_PROXY, 'PAYMENTS_HOST', 'PAYMENTS_PORT'),
    PaymentsClient,
    ChatGateway,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
