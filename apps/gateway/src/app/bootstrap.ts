import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { parseOrigins, parseTrustProxy, type GatewayConfig } from './config';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { REFRESH_COOKIE } from './http/cookies';
import { correlationIdMiddleware } from './http/request-context';

export const GLOBAL_PREFIX = 'api';

/** Everything main.ts applies, shared with tests so they exercise the same stack. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService<GatewayConfig, true>);
  const docs = config.get('API_DOCS', { infer: true });

  // Rate limits key on req.ip, so X-Forwarded-For is trusted only from the
  // proxies TRUST_PROXY names (validated at startup).
  app.set(
    'trust proxy',
    parseTrustProxy(config.get('TRUST_PROXY', { infer: true })),
  );
  // Swagger UI needs inline scripts; the JSON API itself doesn't care about CSP.
  app.use(helmet({ contentSecurityPolicy: docs ? false : undefined }));
  app.use(cookieParser(config.get('COOKIE_SECRET', { infer: true })));
  app.use(correlationIdMiddleware);
  app.enableCors({
    origin: parseOrigins(config.get('CORS_ORIGINS', { infer: true })),
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });
  app.useBodyParser('json', { limit: '100kb' });
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());

  if (docs) {
    SwaggerModule.setup(
      `${GLOBAL_PREFIX}/docs`,
      app,
      buildOpenApiDocument(app),
    );
  }
}

/** Source for the PWA's generated API client (`nx run gateway:openapi`). */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('BorrowBox API')
      .setVersion('1')
      .addBearerAuth()
      // Scheme name must match @ApiCookieAuth(REFRESH_COOKIE) on the controllers.
      .addCookieAuth(
        REFRESH_COOKIE,
        { type: 'apiKey', in: 'cookie' },
        REFRESH_COOKIE,
      )
      .build(),
  );
}

/** Stable serialisation for the committed `apps/gateway/openapi.json`. */
export function serializeOpenApi(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
