import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorBody } from '../identity/identity.client';

const DEFAULT_CODES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

/**
 * Every error leaves as `{ statusCode, code, message }`. Unexpected errors are
 * logged by name only (their messages can contain request data: passwords,
 * tokens, emails) and answered with a generic 500.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const body = toBody(exception);
    if (body.statusCode >= 500 && !(exception instanceof HttpException)) {
      this.logger.error(
        `Unhandled ${(exception as Error)?.name ?? typeof exception} on ${req.method} ${req.route?.path ?? req.path} (correlationId=${req.correlationId})`,
      );
    }
    res.status(body.statusCode).json(body);
  }
}

/**
 * Client errors raised before routing by body-parser that Nest passes through
 * unchanged (`http-errors`: an `expose`d 4xx `status`), e.g. an oversized
 * body. Only generic text is returned.
 */
function bodyParserError(exception: unknown): ApiErrorBody | null {
  const e = exception as { status?: unknown; expose?: unknown };
  if (
    e?.expose !== true ||
    typeof e.status !== 'number' ||
    e.status < 400 ||
    e.status > 499
  ) {
    return null;
  }
  return {
    statusCode: e.status,
    code:
      e.status === HttpStatus.BAD_REQUEST
        ? 'MALFORMED_REQUEST'
        : (DEFAULT_CODES[e.status] ?? 'ERROR'),
    message:
      e.status === HttpStatus.PAYLOAD_TOO_LARGE
        ? 'Request body is too large'
        : 'Malformed request',
  };
}

function toBody(exception: unknown): ApiErrorBody {
  const parserError = bodyParserError(exception);
  if (parserError) return parserError;
  if (!(exception instanceof HttpException)) {
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      message: 'Internal error',
    };
  }
  const statusCode = exception.getStatus();
  const response = exception.getResponse() as
    string | { code?: string; message?: string | string[] };
  if (typeof response === 'object' && typeof response.code === 'string') {
    return {
      statusCode,
      code: response.code,
      message: String(response.message ?? response.code),
    };
  }
  // Nest wraps body-parser's SyntaxError (bad JSON) and URIError (bad %-escape)
  // as `new BadRequestException(err.message)`; that message can quote the
  // body. Our own 400s carry a `code`, ValidationPipe's carry an array.
  if (
    statusCode === HttpStatus.BAD_REQUEST &&
    (typeof response === 'string' || typeof response.message === 'string')
  ) {
    return {
      statusCode,
      code: 'MALFORMED_REQUEST',
      message: 'Malformed request',
    };
  }
  // Nest built-ins (ValidationPipe, guards, throttler, 404s).
  const message =
    typeof response === 'string'
      ? response
      : Array.isArray(response.message)
        ? response.message.join('; ')
        : (response.message ?? exception.message);
  return {
    statusCode,
    code:
      DEFAULT_CODES[statusCode] ?? (statusCode >= 500 ? 'INTERNAL' : 'ERROR'),
    message: statusCode >= 500 ? 'Internal error' : message,
  };
}
