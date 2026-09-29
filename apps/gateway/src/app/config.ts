import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const toInt = () =>
  Transform(({ value }) => (value === undefined ? value : Number(value)));
const emptyToUndefined = () =>
  Transform(({ value }) => (value === '' ? undefined : value));

/**
 * Gateway environment. Stateless: no database. Secrets come from env / Docker
 * secrets only (never committed); see `apps/gateway/.env.example`.
 */
export class GatewayConfig {
  @IsString()
  @IsNotEmpty()
  GATEWAY_HOST = '127.0.0.1';

  @toInt()
  @IsInt()
  @Min(1)
  @Max(65535)
  GATEWAY_PORT = 3000;

  /** Identity's TCP endpoint (ADR-0005). */
  @IsString()
  @IsNotEmpty()
  IDENTITY_HOST = '127.0.0.1';

  @toInt()
  @IsInt()
  @Min(1)
  @Max(65535)
  IDENTITY_PORT = 4001;

  @toInt()
  @IsInt()
  @Min(100)
  RPC_TIMEOUT_MS = 5000;

  /** Rate-limit counters (shared across gateway instances). */
  @Matches(/^rediss?:\/\//, { message: 'REDIS_URL must be a redis:// URL' })
  REDIS_URL!: string;

  /** Comma-separated browser origins allowed by CORS. */
  @Matches(/^https?:\/\/[^,\s]+(,https?:\/\/[^,\s]+)*$/, {
    message: 'CORS_ORIGINS must be a comma-separated list of origins',
  })
  CORS_ORIGINS = 'http://localhost:4200';

  /** Where the gateway sends the browser after Google sign-in. */
  @Matches(/^https?:\/\/[^\s]+$/, { message: 'WEB_APP_URL must be a URL' })
  WEB_APP_URL = 'http://localhost:4200';

  /** Signs the short-lived Google sign-in cookie (state, nonce, PKCE verifier). */
  @IsString()
  @MinLength(32, { message: 'COOKIE_SECRET must be at least 32 characters' })
  COOKIE_SECRET!: string;

  /** SPKI PEM (escaped `\n` allowed), see `tools/gen-jwt-keys.mjs`. */
  @IsString()
  @IsNotEmpty()
  JWT_PUBLIC_KEY!: string;

  @IsString()
  @IsNotEmpty()
  JWT_KEY_ID!: string;

  /** Google sign-in is offered only when set (public value; the secret stays in Identity). */
  @emptyToUndefined()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  GOOGLE_CLIENT_ID?: string;

  @Matches(/^https:\/\/[^\s]+$/, {
    message: 'GOOGLE_AUTHORIZATION_ENDPOINT must be an https URL',
  })
  GOOGLE_AUTHORIZATION_ENDPOINT =
    'https://accounts.google.com/o/oauth2/v2/auth';

  /** Must match the redirect URI registered with Google. */
  @Matches(/^https?:\/\/[^\s]+$/, {
    message: 'GOOGLE_REDIRECT_URI must be a URL',
  })
  GOOGLE_REDIRECT_URI = 'http://localhost:4200/api/auth/google/callback';

  /** Serve Swagger UI at /api/docs (development only). */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  API_DOCS = false;
}

/** For `ConfigModule.forRoot({ validate })`. Error messages name variables, never values. */
export function validateConfig(env: Record<string, unknown>): GatewayConfig {
  const config = plainToInstance(GatewayConfig, env);
  const errors = validateSync(config);
  if (errors.length > 0) {
    const problems = errors.map(
      (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
    );
    throw new Error(
      `Invalid Gateway configuration:\n  ${problems.join('\n  ')}`,
    );
  }
  return config;
}

export function parseOrigins(corsOrigins: string): string[] {
  return corsOrigins.split(',').map((o) => o.trim());
}
