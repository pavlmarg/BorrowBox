import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { BaseServiceConfig, configValidator } from '@borrowbox/service-kit';

/**
 * Notifications' environment. Secrets come from env / Docker secrets only
 * (never committed); see `apps/notifications/.env.example`.
 */
export class NotificationsConfig extends BaseServiceConfig {
  /** TCP bind address. `0.0.0.0` inside Docker; never publish the port on the host in production. */
  @IsString()
  @IsNotEmpty()
  NOTIFICATIONS_HOST = '127.0.0.1';

  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  NOTIFICATIONS_PORT = 4004;

  /**
   * SMTP (ADR-0016): Mailpit in dev. Empty disables sending (each email is
   * skipped with a warning), e.g. in tests.
   */
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  SMTP_HOST?: string;

  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT = 1025;

  /** TLS from the start (port 465); otherwise STARTTLS (required once SMTP_USER is set). */
  @Transform(({ value }) =>
    value === undefined ? value : value === true || value === 'true',
  )
  @IsBoolean()
  SMTP_SECURE = false;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsString()
  @IsNotEmpty()
  MAIL_FROM = 'BorrowBox <no-reply@borrowbox.localhost>';

  /** The PWA's origin, for links in emails. No trailing slash. */
  @Matches(/^https?:\/\/[^/]+$/, {
    message: 'WEB_BASE_URL must be an origin like https://borrowbox.gr',
  })
  WEB_BASE_URL = 'http://localhost:4200';
}

/** For `ConfigModule.forRoot({ validate })`. Error messages name variables, never values. */
export const validateConfig = configValidator(
  NotificationsConfig,
  'Notifications',
);
