import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMailer } from '@borrowbox/mailer';
import type { IdentityConfig } from '../config';
import { AccountMailer, MAILER } from './account-mailer';

/** SMTP and Identity's account-security emails (ADR-0016). */
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<IdentityConfig, true>) =>
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
    AccountMailer,
  ],
  exports: [AccountMailer],
})
export class EmailModule {}
