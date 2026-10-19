import {
  Catch,
  Injectable,
  Logger,
  ValidationPipe,
  type ArgumentsHost,
  type PipeTransform,
  type RpcExceptionFilter,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { throwError, type Observable } from 'rxjs';
import type { RpcErrorBody } from '@borrowbox/contracts';

/** Codes every service's error contract includes. */
export type CommonRpcErrorCode = 'VALIDATION_FAILED' | 'INTERNAL';

/**
 * An expected, client-facing failure. `message` reaches the browser, so it must
 * never contain personal data, input values or internals. Each service
 * narrows `code` with a subclass, e.g.
 * `class CatalogError extends ServiceError<CatalogErrorCode> {}`.
 */
export class ServiceError<TCode extends string = string> extends Error {
  constructor(
    readonly code: TCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Validates `@Payload('data')` DTOs; rejects unknown fields. Error lists fields, never values. */
export const rpcValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors) =>
    new ServiceError<CommonRpcErrorCode>(
      'VALIDATION_FAILED',
      `Invalid fields: ${errors.map((e) => e.property).join(', ')}`,
    ),
});

/** `RpcRequest.correlationId` ends up in event envelopes and logs, so keep it small and inert. */
@Injectable()
export class CorrelationIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
      return value;
    }
    throw new ServiceError<CommonRpcErrorCode>(
      'VALIDATION_FAILED',
      'Invalid fields: correlationId',
    );
  }
}

/** Turns every error into an `RpcErrorBody` for the gateway. */
@Catch()
export class RpcErrorFilter implements RpcExceptionFilter<unknown> {
  private readonly logger = new Logger('Rpc');

  catch(exception: unknown, host: ArgumentsHost): Observable<RpcErrorBody> {
    if (exception instanceof ServiceError) {
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
    return throwError(() =>
      body<CommonRpcErrorCode>('INTERNAL', 'Internal error'),
    );
  }
}

function body<TCode extends string>(
  code: TCode,
  message: string,
): RpcErrorBody<TCode> {
  return { code, message };
}
