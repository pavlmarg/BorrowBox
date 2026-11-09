import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { BaseServiceConfig, configValidator } from '@borrowbox/service-kit';

/**
 * Payments' environment. Secrets come from env / Docker secrets only (never
 * committed); see `apps/payments/.env.example`.
 */
export class PaymentsConfig extends BaseServiceConfig {
  /** TCP bind address. `0.0.0.0` inside Docker; never publish the port on the host in production. */
  @IsString()
  @IsNotEmpty()
  PAYMENTS_HOST = '127.0.0.1';

  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  PAYMENTS_PORT = 4005;

  /**
   * Test mode only (CLAUDE.md): a live key (`sk_live_…`) stops the service
   * from starting, so real money can't move by accident.
   */
  @Matches(/^(sk|rk)_test_[A-Za-z0-9]+$/, {
    message: 'STRIPE_SECRET_KEY must be a Stripe test-mode key (sk_test_…)',
  })
  STRIPE_SECRET_KEY!: string;

  /** Signing secret of the platform webhook endpoint (payments, from PR B). */
  @Matches(/^whsec_[A-Za-z0-9]+$/, {
    message: 'STRIPE_WEBHOOK_SECRET must be a webhook signing secret (whsec_…)',
  })
  STRIPE_WEBHOOK_SECRET!: string;

  /** Signing secret of the Connect webhook endpoint (lenders' accounts). */
  @Matches(/^whsec_[A-Za-z0-9]+$/, {
    message:
      'STRIPE_CONNECT_WEBHOOK_SECRET must be a webhook signing secret (whsec_…)',
  })
  STRIPE_CONNECT_WEBHOOK_SECRET!: string;

  /** Country of new lenders' Stripe accounts (ISO 3166-1 alpha-2). */
  @Matches(/^[A-Z]{2}$/, {
    message: 'STRIPE_ACCOUNT_COUNTRY must be a two-letter country code',
  })
  STRIPE_ACCOUNT_COUNTRY = 'GR';

  /** The PWA's origin; Stripe sends lenders back to it after onboarding. No trailing slash. */
  @Matches(/^https?:\/\/[^/]+$/, {
    message: 'WEB_BASE_URL must be an origin like https://borrowbox.gr',
  })
  WEB_BASE_URL = 'http://localhost:4200';
}

/** For `ConfigModule.forRoot({ validate })`. Error messages name variables, never values. */
export const validateConfig = configValidator(PaymentsConfig, 'Payments');
