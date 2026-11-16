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
 * Bookings' environment. Secrets come from env / Docker secrets only (never
 * committed); see `apps/bookings/.env.example`. Bookings only verifies
 * access tokens, so it has no access-token signing key; it has its own
 * key for handoff QR tokens.
 */
export class BookingsConfig extends BaseServiceConfig {
  /** TCP bind address. `0.0.0.0` inside Docker; never publish the port on the host in production. */
  @IsString()
  @IsNotEmpty()
  BOOKINGS_HOST = '127.0.0.1';

  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  BOOKINGS_PORT = 4003;

  /** BullMQ (expiry jobs). Includes the password: `redis://:<password>@host:port`. */
  @Matches(/^rediss?:\/\//, { message: 'REDIS_URL must be a redis:// URL' })
  REDIS_URL!: string;

  /**
   * Ed25519 PKCS#8 PEM (escaped `\n` allowed) signing the handoff QR tokens
   * (ARCHITECTURE.md §5). Bookings both signs and checks them; no other
   * service has it. `node tools/gen-handoff-key.mjs`.
   */
  @IsString()
  @IsNotEmpty()
  HANDOFF_PRIVATE_KEY!: string;

  /**
   * Object storage for condition photos (ADR-0027): SeaweedFS in dev, R2 in
   * production. Presigned links point here, so browsers must reach it.
   */
  @Matches(/^https?:\/\/[^\s]+$/, {
    message: 'S3_ENDPOINT must be an http(s):// URL',
  })
  S3_ENDPOINT!: string;

  /** `us-east-1` for SeaweedFS, `auto` for R2. */
  @IsString()
  @IsNotEmpty()
  S3_REGION = 'us-east-1';

  /** Bookings' own key: the uploads and evidence buckets only, never the public one. */
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

  /** Private: processed condition photos, read only through presigned links. */
  @IsString()
  @IsNotEmpty()
  S3_EVIDENCE_BUCKET!: string;
}

/** For `ConfigModule.forRoot({ validate })`. Error messages name variables, never values. */
export const validateConfig = configValidator(BookingsConfig, 'Bookings');
