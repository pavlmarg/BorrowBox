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
 * Identity's environment. Secrets come from env / Docker secrets only
 * (never committed); see `apps/identity/.env.example`.
 */
export class IdentityConfig {
  /** Connects as the `identity_svc` role; its search_path is the `identity` schema (ADR-0002). */
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgres:// URL',
  })
  DATABASE_URL!: string;

  @Matches(/^amqps?:\/\//, { message: 'RABBITMQ_URL must be an amqp:// URL' })
  RABBITMQ_URL!: string;

  /** TCP bind address. `0.0.0.0` inside Docker; never publish the port on the host in production. */
  @IsString()
  @IsNotEmpty()
  IDENTITY_HOST = '127.0.0.1';

  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  IDENTITY_PORT = 4001;

  /** Run pending migrations on startup (dev). In production run `nx run identity:migrate` instead. */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  DB_MIGRATIONS_RUN = false;

  /** SPKI PEM (escaped `\n` allowed), see `tools/gen-jwt-keys.mjs`. */
  @IsString()
  @IsNotEmpty()
  JWT_PUBLIC_KEY!: string;

  /** PKCS#8 PEM (escaped `\n` allowed). Identity is the only holder of the signing key. */
  @IsString()
  @IsNotEmpty()
  JWT_PRIVATE_KEY!: string;

  @IsString()
  @IsNotEmpty()
  JWT_KEY_ID!: string;
}

/** For `ConfigModule.forRoot({ validate })`. Error messages name variables, never values. */
export function validateConfig(env: Record<string, unknown>): IdentityConfig {
  const config = plainToInstance(IdentityConfig, env, {
    excludeExtraneousValues: false,
  });
  const errors = validateSync(config, { skipMissingProperties: false });
  if (errors.length > 0) {
    const problems = errors.map(
      (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
    );
    throw new Error(
      `Invalid Identity configuration:\n  ${problems.join('\n  ')}`,
    );
  }
  return config;
}
