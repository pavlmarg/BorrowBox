import { isIP } from 'node:net';
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
  registerDecorator,
  validateSync,
} from 'class-validator';

const toInt = () =>
  Transform(({ value }) => (value === undefined ? value : Number(value)));
const emptyToUndefined = () =>
  Transform(({ value }) => (value === '' ? undefined : value));

/** Express's named ranges for `trust proxy`. */
const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);
const MAX_PROXY_HOPS = 10;

/** `ip` or `ip/prefix`, with the prefix in range for the address family. */
function isAddressOrCidr(value: string): boolean {
  const [address, prefix, ...rest] = value.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^[0-9]{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Parses TRUST_PROXY into Express's `trust proxy` setting, or null if invalid.
 * - `false`: ignore X-Forwarded-For (the gateway is reached directly)
 * - `0`–`10`: trust that many proxy hops
 * - comma-separated IPs, CIDRs and named ranges (`loopback`, `linklocal`,
 *   `uniquelocal`), e.g. `loopback,172.16.0.0/12` for Caddy on a Docker network
 * `true` (trust every sender) is refused: any client could then fake its IP
 * and dodge the per-IP rate limits.
 */
export function parseTrustProxy(
  value: string,
): false | number | string[] | null {
  const trimmed = value.trim();
  if (trimmed === 'false') return false;
  if (/^[0-9]+$/.test(trimmed)) {
    const hops = Number(trimmed);
    return hops <= MAX_PROXY_HOPS ? hops : null;
  }
  const entries = trimmed.split(',').map((e) => e.trim());
  const valid = entries.every((e) => NAMED_RANGES.has(e) || isAddressOrCidr(e));
  return valid && entries.length > 0 ? entries : null;
}

function IsTrustProxy(): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isTrustProxy',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message:
          'TRUST_PROXY must be false, a hop count (0-10), or comma-separated IPs/CIDRs/loopback/linklocal/uniquelocal',
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && parseTrustProxy(value) !== null,
      },
    });
}

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

  /**
   * Which senders may set X-Forwarded-For (rate limits key on the client IP).
   * `loopback` fits dev (Angular proxy) and Caddy on the same host; Caddy in
   * Docker Compose needs its network, e.g. `loopback,172.16.0.0/12`.
   */
  @IsTrustProxy()
  TRUST_PROXY = 'loopback';

  /** Identity's TCP endpoint (ADR-0005). */
  @IsString()
  @IsNotEmpty()
  IDENTITY_HOST = '127.0.0.1';

  @toInt()
  @IsInt()
  @Min(1)
  @Max(65535)
  IDENTITY_PORT = 4001;

  /** Catalog's TCP endpoint (ADR-0005). */
  @IsString()
  @IsNotEmpty()
  CATALOG_HOST = '127.0.0.1';

  @toInt()
  @IsInt()
  @Min(1)
  @Max(65535)
  CATALOG_PORT = 4002;

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
