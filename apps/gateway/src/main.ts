import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { GatewayConfig } from './app/config';

/**
 * `node main.js openapi <file>` (`nx run gateway:openapi`): writes the OpenAPI
 * spec without connecting to anything. Required env gets inert placeholders;
 * preview mode builds the module graph without instantiating providers.
 */
async function writeOpenApi(file: string): Promise<void> {
  const placeholders: Record<string, string> = {
    REDIS_URL: 'redis://127.0.0.1:1',
    COOKIE_SECRET: 'x'.repeat(32),
    JWT_PUBLIC_KEY: 'placeholder',
    JWT_KEY_ID: 'placeholder',
  };
  for (const [key, value] of Object.entries(placeholders)) {
    process.env[key] ??= value;
  }
  const { AppModule } = await import('./app/app.module');
  const { buildOpenApiDocument, serializeOpenApi, GLOBAL_PREFIX } =
    await import('./app/bootstrap');
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });
  app.setGlobalPrefix(GLOBAL_PREFIX);
  writeFileSync(file, serializeOpenApi(buildOpenApiDocument(app)));
  await app.close();
  Logger.log(`OpenAPI spec written to ${file}`, 'OpenApi');
}

async function serve(): Promise<void> {
  const { AppModule } = await import('./app/app.module');
  const { configureApp, GLOBAL_PREFIX } = await import('./app/bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false, // configured (with a size limit) in configureApp
  });
  configureApp(app);
  app.enableShutdownHooks();
  const config = app.get(ConfigService<GatewayConfig, true>);
  const host = config.get('GATEWAY_HOST', { infer: true });
  const port = config.get('GATEWAY_PORT', { infer: true });
  await app.listen(port, host);
  Logger.log(
    `Gateway listening on http://${host}:${port}/${GLOBAL_PREFIX}`,
    'Bootstrap',
  );
}

const run =
  process.argv[2] === 'openapi'
    ? () => writeOpenApi(process.argv[3] ?? 'apps/gateway/openapi.json')
    : serve;
run().catch((err: unknown) => {
  Logger.error(
    err instanceof Error ? err.message : String(err),
    undefined,
    'Bootstrap',
  );
  process.exit(1);
});
