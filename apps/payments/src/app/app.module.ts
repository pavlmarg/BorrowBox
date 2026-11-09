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
import { PayoutsService } from './accounts/payouts.service';
import { validateConfig, type PaymentsConfig } from './config';
import { PaymentsDatabaseModule } from './database/database.module';
import { BookingEventsConsumer } from './checkout/booking-events.consumer';
import { CheckoutService } from './checkout/checkout.service';
import {
  CheckoutController,
  PayoutsController,
  WebhooksController,
} from './payments.controller';
import { PaymentsWorker } from './payments.worker';
import { SdkStripeApi, STRIPE_API } from './stripe/stripe-api';
import { UserEventsConsumer } from './users/user-events.consumer';
import { WebhooksService } from './webhooks/webhooks.service';

export const configModule = serviceConfigModule('payments', validateConfig);

/**
 * Lenders' Stripe connected accounts, renters' payments and Stripe's
 * webhooks (ADR-0003, ADR-0019). Stripe test mode only.
 */
@Module({
  imports: [
    configModule,
    PaymentsDatabaseModule,
    EventsModule,
    AuthModule.forRoot({
      inject: [ConfigService],
      useFactory: (config: ConfigService<PaymentsConfig, true>) => ({
        publicKeyPem: pemFromEnv(
          config.get('JWT_PUBLIC_KEY', { infer: true }),
          'JWT_PUBLIC_KEY',
        ),
        keyId: config.get('JWT_KEY_ID', { infer: true }),
      }),
    }),
  ],
  controllers: [PayoutsController, CheckoutController, WebhooksController],
  providers: [
    {
      provide: STRIPE_API,
      inject: [ConfigService],
      useFactory: (config: ConfigService<PaymentsConfig, true>) =>
        new SdkStripeApi(config.get('STRIPE_SECRET_KEY', { infer: true })),
    },
    PayoutsService,
    CheckoutService,
    WebhooksService,
    PaymentsWorker,
    UserEventsConsumer,
    BookingEventsConsumer,
    { provide: APP_PIPE, useValue: rpcValidationPipe },
    { provide: APP_FILTER, useClass: RpcErrorFilter },
  ],
})
export class AppModule {}

/** `node main.js migrate`: only config + database, no broker or TCP listener. */
@Module({ imports: [configModule, PaymentsDatabaseModule] })
export class MigrateModule {}
