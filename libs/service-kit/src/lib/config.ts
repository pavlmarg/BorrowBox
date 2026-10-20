import { join } from 'node:path';
import type { DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  Matches,
  validateSync,
} from 'class-validator';

/**
 * The settings every service has. Each service extends it with its own
 * (TCP host/port, storage, …). Secrets come from env / Docker secrets only.
 */
export class BaseServiceConfig {
  /** Connects as the service's own role; its search_path is the service's schema (ADR-0002). */
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL must be a postgres:// URL',
  })
  DATABASE_URL!: string;

  @Matches(/^amqps?:\/\//, { message: 'RABBITMQ_URL must be an amqp:// URL' })
  RABBITMQ_URL!: string;

  /** Run pending migrations on startup (dev). In production run `nx run <app>:migrate` instead. */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  DB_MIGRATIONS_RUN = false;

  /** SPKI PEM (escaped `\n` allowed), see `tools/gen-jwt-keys.mjs`. */
  @IsString()
  @IsNotEmpty()
  JWT_PUBLIC_KEY!: string;

  @IsString()
  @IsNotEmpty()
  JWT_KEY_ID!: string;
}

/**
 * Builds the `validate` function for `ConfigModule.forRoot`. Error messages
 * name variables, never values.
 */
export function configValidator<T extends object>(
  configClass: new () => T,
  serviceName: string,
): (env: Record<string, unknown>) => T {
  return (env) => {
    const config = plainToInstance(configClass, env, {
      excludeExtraneousValues: false,
    });
    const errors = validateSync(config, { skipMissingProperties: false });
    if (errors.length > 0) {
      const problems = errors.map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      );
      throw new Error(
        `Invalid ${serviceName} configuration:\n  ${problems.join('\n  ')}`,
      );
    }
    return config;
  };
}

/**
 * Global config for a service. Dev reads `apps/<app>/.env` (gitignored);
 * elsewhere env comes from the environment, and tests set their own.
 */
export function serviceConfigModule<T extends object>(
  app: string,
  validate: (env: Record<string, unknown>) => T,
): Promise<DynamicModule> {
  return ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: join(process.cwd(), `apps/${app}/.env`),
    // A developer's local .env must not leak into tests.
    ignoreEnvFile: process.env['NODE_ENV'] === 'test',
    validate,
    cache: true,
  });
}
