import { Logger, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AuthModule, pemFromEnv } from '@borrowbox/auth';
import { createMailer } from '@borrowbox/mailer';
import {
  EventsModule,
  RpcErrorFilter,
  rpcValidationPipe,
  serviceConfigModule,
} from '@borrowbox/service-kit';
import { validateConfig, type NotificationsConfig } from './config';
import { NotificationsDatabaseModule } from './database/database.module';
import { EmailSender, MAILER } from './emails/email-sender';
import { EventsConsumer } from './events/events.consumer';
import { ExportController } from './export/export.controller';

export const configModule = serviceConfigModule(
  'notifications',
  validateConfig,
);

/** Emails people about their bookings, offers and messages (ADR-0016). */
@Module({
  imports: [
    configModule,
    NotificationsDatabaseModule,
    EventsModule,
    AuthModule.forRoot({
      inject: [ConfigService],
      useFactory: (config: ConfigService<NotificationsConfig, true>) => ({
        publicKeyPem: pemFromEnv(
          config.get('JWT_PUBLIC_KEY', { infer: true }),
          'JWT_PUBLIC_KEY',
        ),
        keyId: config.get('JWT_KEY_ID', { infer: true }),
      }),
    }),
  ],
  controllers: [ExportController],
  providers: [
    {
      provide: MAILER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<NotificationsConfig, true>) =>
        createMailer(
          {
            host: config.get('SMTP_HOST', { infer: true }),
            port: config.get('SMTP_PORT', { infer: true }),
            secure: config.get('SMTP_SECURE', { infer: true }),
            user: config.get('SMTP_USER', { infer: true }),
            password: config.get('SMTP_PASSWORD', { infer: true }),
            from: config.get('MAIL_FROM', { infer: true }),
          },
          new Logger('Mailer'),
        ),
    },
    EmailSender,
    EventsConsumer,
    { provide: APP_PIPE, useValue: rpcValidationPipe },
    { provide: APP_FILTER, useClass: RpcErrorFilter },
  ],
})
export class AppModule {}

/** `node main.js migrate`: only config + database, no broker or TCP listener. */
@Module({ imports: [configModule, NotificationsDatabaseModule] })
export class MigrateModule {}
