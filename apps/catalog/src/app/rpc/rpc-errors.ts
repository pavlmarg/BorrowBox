import {
  Catch,
  Logger,
  ValidationPipe,
  type ArgumentsHost,
  type RpcExceptionFilter,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { throwError, type Observable } from 'rxjs';
import type { CatalogErrorCode, RpcErrorBody } from '@borrowbox/contracts';

/** An expected, client-facing failure. `message` must never contain personal data. */
export class CatalogError extends Error {
  constructor(
    readonly code: CatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogError';
  }
}

/** Validates `@Payload('data')` DTOs; rejects unknown fields. Error lists fields, never values. */
export const rpcValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors) =>
    new CatalogError(
      'VALIDATION_FAILED',
      `Invalid fields: ${errors.map((e) => e.property).join(', ')}`,
    ),
});

/** Turns every error into an `RpcErrorBody` for the gateway. */
@Catch()
export class CatalogRpcExceptionFilter implements RpcExceptionFilter<unknown> {
  private readonly logger = new Logger('Rpc');

  catch(exception: unknown, host: ArgumentsHost): Observable<RpcErrorBody> {
    if (exception instanceof CatalogError) {
      return throwError(() => body(exception.code, exception.message));
    }
    if (exception instanceof RpcException) {
      // e.g. RpcJwtAuthGuard's UNAUTHENTICATED; already an RpcErrorBody.
      return throwError(() => exception.getError() as RpcErrorBody);
    }
    // Log shape only: DB and library messages can echo input (emails, etc.).
    const err = exception as {
      name?: string;
      code?: string;
      constraint?: string;
    };
    this.logger.error(
      `Unhandled ${err?.name ?? typeof exception} in ${host.switchToRpc().getContext()?.getPattern?.() ?? 'rpc'}` +
        (err?.code ? ` code=${err.code}` : '') +
        (err?.constraint ? ` constraint=${err.constraint}` : ''),
    );
    return throwError(() => body('INTERNAL', 'Internal error'));
  }
}

function body(
  code: CatalogErrorCode,
  message: string,
): RpcErrorBody<CatalogErrorCode> {
  return { code, message };
}
