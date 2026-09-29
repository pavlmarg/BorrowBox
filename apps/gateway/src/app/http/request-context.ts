import { randomUUID } from 'node:crypto';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

declare module 'express' {
  interface Request {
    correlationId?: string;
  }
}

/**
 * Every request gets a correlation id: the caller's `X-Request-Id` if it is
 * small and inert, else a new UUID. It is echoed back, forwarded to services
 * and ends up in event envelopes.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(REQUEST_ID_HEADER);
  req.correlationId =
    incoming && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming)
      ? incoming
      : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.correlationId);
  next();
}

export const CorrelationId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<Request>().correlationId ?? randomUUID(),
);

/** The raw bearer token, for forwarding to services. Use only behind JwtAuthGuard. */
export const AccessToken = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const header = ctx
      .switchToHttp()
      .getRequest<Request>()
      .header('authorization');
    return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  },
);
