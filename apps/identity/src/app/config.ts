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
  ValidateIf,
} from 'class-validator';
import { BaseServiceConfig, configValidator } from '@borrowbox/service-kit';

/**
 * Identity's environment. Secrets come from env / Docker secrets only
 * (never committed); see `apps/identity/.env.example`.
 */
export class IdentityConfig extends BaseServiceConfig {
  /** TCP bind address. `0.0.0.0` inside Docker; never publish the port on the host in production. */
  @IsString()
  @IsNotEmpty()
  IDENTITY_HOST = '127.0.0.1';

  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  IDENTITY_PORT = 4001;

  /** PKCS#8 PEM (escaped `\n` allowed). Identity is the only holder of the signing key. */
  @IsString()
  @IsNotEmpty()
  JWT_PRIVATE_KEY!: string;

  /** OIDC issuer for Google sign-in. Only tests point this elsewhere (a local fake provider). */
  @Matches(/^https?:\/\//, { message: 'GOOGLE_ISSUER must be a URL' })
  GOOGLE_ISSUER = 'https://accounts.google.com';

  /** Google sign-in is disabled unless both are set. Empty (`GOOGLE_CLIENT_ID=`) counts as unset. */
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  GOOGLE_CLIENT_ID?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @ValidateIf((c: IdentityConfig) => c.GOOGLE_CLIENT_ID !== undefined)
  @IsString()
  @IsNotEmpty({
    message: 'GOOGLE_CLIENT_SECRET is required with GOOGLE_CLIENT_ID',
  })
  GOOGLE_CLIENT_SECRET?: string;

  /**
   * SMTP for account-security emails (ADR-0016): Mailpit in dev. Empty
   * disables sending (each email is skipped with a warning), e.g. in tests.
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

  /**
   * Where browsers load processed profile photos from (ADR-0024): the public
   * bucket, e.g. `http://localhost:8333/borrowbox-public` in dev, the R2
   * custom domain in production. No default, so production never serves the
   * dev address.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\/+$/, '') : value,
  )
  @Matches(/^https?:\/\/[^\s]+$/, {
    message: 'PHOTOS_BASE_URL must be an http(s):// URL',
  })
  PHOTOS_BASE_URL!: string;

  /** BullMQ (profile photo jobs). Includes the password: `redis://:<password>@host:port`. */
  @Matches(/^rediss?:\/\//, { message: 'REDIS_URL must be a redis:// URL' })
  REDIS_URL!: string;

  /** Object storage (ADR-0009): SeaweedFS in dev, R2 in production. */
  @Matches(/^https?:\/\/[^\s]+$/, {
    message: 'S3_ENDPOINT must be an http(s):// URL',
  })
  S3_ENDPOINT!: string;

  /** `us-east-1` for SeaweedFS, `auto` for R2. */
  @IsString()
  @IsNotEmpty()
  S3_REGION = 'us-east-1';

  /** Identity's own key: read/write on the two buckets only, never Catalog's. */
  @IsString()
  @IsNotEmpty()
  S3_ACCESS_KEY_ID!: string;

  @IsString()
  @IsNotEmpty()
  S3_SECRET_ACCESS_KEY!: string;

  /** Private: raw uploads under incoming/. */
  @IsString()
  @IsNotEmpty()
  S3_UPLOADS_BUCKET!: string;

  /** Public-read: processed photos only. */
  @IsString()
  @IsNotEmpty()
  S3_PUBLIC_BUCKET!: string;
}

/** For `ConfigModule.forRoot({ validate })`. Error messages name variables, never values. */
export const validateConfig = configValidator(IdentityConfig, 'Identity');
