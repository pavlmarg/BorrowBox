import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/**
 * Catalog's environment. Secrets come from env / Docker secrets only
 * (never committed); see `apps/catalog/.env.example`.
 */
export class CatalogConfig {
  /** Connects as the `catalog_svc` role; its search_path is the `catalog` schema (ADR-0002). */
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgres:// URL',
  })
  DATABASE_URL!: string;

  @Matches(/^amqps?:\/\//, { message: 'RABBITMQ_URL must be an amqp:// URL' })
  RABBITMQ_URL!: string;

  /** TCP bind address. `0.0.0.0` inside Docker; never publish the port on the host in production. */
  @IsString()
  @IsNotEmpty()
  CATALOG_HOST = '127.0.0.1';

  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  CATALOG_PORT = 4002;

  /** Run pending migrations on startup (dev). In production run `nx run catalog:migrate` instead. */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  DB_MIGRATIONS_RUN = false;

  /** SPKI PEM (escaped `\n` allowed), see `tools/gen-jwt-keys.mjs`. Catalog only verifies tokens. */
  @IsString()
  @IsNotEmpty()
  JWT_PUBLIC_KEY!: string;

  @IsString()
  @IsNotEmpty()
  JWT_KEY_ID!: string;

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
export function validateConfig(env: Record<string, unknown>): CatalogConfig {
  const config = plainToInstance(CatalogConfig, env, {
    excludeExtraneousValues: false,
  });
  const errors = validateSync(config, { skipMissingProperties: false });
  if (errors.length > 0) {
    const problems = errors.map(
      (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
    );
    throw new Error(
      `Invalid Catalog configuration:\n  ${problems.join('\n  ')}`,
    );
  }
  return config;
}
