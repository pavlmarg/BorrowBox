import {
  HttpStatus,
  Logger,
  type HttpException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom, timeout, TimeoutError } from 'rxjs';
import type { RpcErrorBody, RpcRequest } from '@borrowbox/contracts';
import { apiError } from '../http/api-error';

/** A service's `<Service>RpcContract`: pattern → request/response types. */
export type RpcContract<C> = {
  [P in keyof C]: { request: unknown; response: unknown };
};

/** Per-request context forwarded with every call. */
export interface CallContext {
  correlationId: string;
  /** Forwarded so the service re-verifies it (defence in depth). */
  accessToken?: string;
}

export interface ServiceClientOptions<C, E extends string> {
  /** For logs only; never sent to clients (they see SERVICE_UNAVAILABLE). */
  name: string;
  proxy: ClientProxy;
  defaultTimeoutMs: number;
  /** Every error code the service can return. A missing code is a compile error. */
  statusByCode: Record<E, HttpStatus>;
  /**
   * Longer waits for calls that are slow by nature. Each must exceed
   * everything the service itself waits for while handling the call (e.g.
   * its own HTTP timeouts to third parties); otherwise the gateway gives up
   * while the service may still succeed.
   */
  timeoutOverridesMs?: Partial<Record<keyof C, number>>;
}

const UNAVAILABLE_MESSAGE = 'Service temporarily unavailable, try again later';

/**
 * Typed gateway → service client (ADR-0005). Controllers never use a
 * ClientProxy directly, so the transport can change behind this class.
 *
 * - A service's `RpcErrorBody` becomes an HTTP error through `statusByCode`;
 *   its message is passed through (services must never put personal data or
 *   internals in it).
 * - A code the table doesn't know means the contracts drifted: 500 INTERNAL.
 * - No answer (timeout, connection failure): 503 SERVICE_UNAVAILABLE.
 * - No retries: a command might already have run (see ARCHITECTURE.md §10).
 */
export abstract class ServiceClient<
  C extends RpcContract<C>,
  E extends string,
> implements OnApplicationShutdown {
  private readonly logger: Logger;

  protected constructor(private readonly options: ServiceClientOptions<C, E>) {
    this.logger = new Logger(`${options.name}Client`);
  }

  /** Resolves with the service's response; rejects with an HttpException. */
  async call<P extends keyof C & string>(
    pattern: P,
    data: C[P]['request'],
    context: CallContext,
  ): Promise<C[P]['response']> {
    const message: RpcRequest<C[P]['request']> = {
      correlationId: context.correlationId,
      ...(context.accessToken ? { accessToken: context.accessToken } : {}),
      data,
    };
    const timeoutMs =
      this.options.timeoutOverridesMs?.[pattern] ??
      this.options.defaultTimeoutMs;
    try {
      return await lastValueFrom(
        this.options.proxy.send(pattern, message).pipe(timeout(timeoutMs)),
        // void handlers (e.g. logout, delete) complete without a value.
        { defaultValue: undefined as C[P]['response'] },
      );
    } catch (err) {
      throw this.toHttpError(err, pattern, context.correlationId);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.options.proxy.close();
  }

  /** Never logs `err` itself or the payload: either may carry the request. */
  private toHttpError(
    err: unknown,
    pattern: string,
    correlationId: string,
  ): HttpException {
    if (isRpcErrorBody(err)) {
      const status = (this.options.statusByCode as Record<string, HttpStatus>)[
        err.code
      ];
      if (status !== undefined) return apiError(status, err.code, err.message);
      this.logger.error(
        `${this.options.name} call ${pattern} returned unmapped error code ${err.code} (correlationId=${correlationId})`,
      );
      return apiError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL',
        'Internal error',
      );
    }
    const reason =
      err instanceof TimeoutError
        ? 'timeout'
        : ((err as { code?: string })?.code ??
          (err as Error)?.name ??
          'unknown');
    this.logger.error(
      `${this.options.name} call ${pattern} failed: ${reason} (correlationId=${correlationId})`,
    );
    return apiError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'SERVICE_UNAVAILABLE',
      UNAVAILABLE_MESSAGE,
    );
  }
}

/**
 * An error a service sent on purpose: a plain `{ code, message }` object.
 * Transport failures are `Error` instances, which can also carry a string
 * `code` (e.g. ECONNREFUSED), so those are excluded.
 */
function isRpcErrorBody(err: unknown): err is RpcErrorBody {
  return (
    typeof err === 'object' &&
    err !== null &&
    !(err instanceof Error) &&
    typeof (err as RpcErrorBody).code === 'string' &&
    typeof (err as RpcErrorBody).message === 'string'
  );
}
