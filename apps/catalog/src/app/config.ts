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
 * Catalog's environment. Secrets come from env / Docker secrets only
 * (never committed); see `apps/catalog/.env.example`. Catalog only verifies
 * tokens, so it has no signing key.
 */
export class CatalogConfig extends BaseServiceConfig {
  /** TCP bind address. `0.0.0.0` inside Docker; never publish the port on the host in production. */
  @IsString()
  @IsNotEmpty()
  CATALOG_HOST = '127.0.0.1';

  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  CATALOG_PORT = 4002;

  /**
   * Where browsers load processed photos from: the public bucket, e.g.
   * `http://localhost:8333/borrowbox-public` in dev, the R2 custom domain in
   * production. No default, so production never serves the dev address.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\/+$/, '') : value,
  )
  @Matches(/^https?:\/\/[^\s]+$/, {
    message: 'PHOTOS_BASE_URL must be an http(s):// URL',
  })
  PHOTOS_BASE_URL!: string;

  /** BullMQ (photo jobs). Includes the password: `redis://:<password>@host:port`. */
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

  /** Catalog's scoped key: read/write on the two buckets only. */
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
export const validateConfig = configValidator(CatalogConfig, 'Catalog');
