import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom, timeout, TimeoutError } from 'rxjs';
import type {
  IdentityErrorCode,
  IdentityRpcContract,
  IdentityRpcPattern,
  RpcErrorBody,
  RpcRequest,
} from '@borrowbox/contracts';

export const IDENTITY_PROXY = Symbol('IDENTITY_PROXY');
export const RPC_TIMEOUT_MS = Symbol('RPC_TIMEOUT_MS');

/** Per-request context forwarded with every call. */
export interface CallContext {
  correlationId: string;
  /** Forwarded for `me.*` so Identity re-verifies it (defence in depth). */
  accessToken?: string;
}

/** Body of every error response: `{ statusCode, code, message }`. */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
}

const STATUS: Record<IdentityErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  INVALID_REFRESH_TOKEN: HttpStatus.UNAUTHORIZED,
  REAUTHENTICATION_REQUIRED: HttpStatus.FORBIDDEN,
  EMAIL_TAKEN: HttpStatus.CONFLICT,
  OAUTH_EXCHANGE_FAILED: HttpStatus.BAD_GATEWAY,
  // The user's Google email isn't verified: a refusal, not an upstream failure.
  OAUTH_EMAIL_NOT_VERIFIED: HttpStatus.FORBIDDEN,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

export function apiError(
  status: HttpStatus,
  code: string,
  message: string,
): HttpException {
  const body: ApiErrorBody = { statusCode: status, code, message };
  return new HttpException(body, status);
}

/** Maps an Identity `RpcErrorBody` to an HTTP error; anything else means Identity is unreachable. */
export function toHttpError(err: unknown): HttpException {
  const body = err as Partial<RpcErrorBody> | null;
  if (body && typeof body.code === 'string' && body.code in STATUS) {
    const code = body.code as IdentityErrorCode;
    return apiError(STATUS[code], code, body.message ?? code);
  }
  return apiError(
    HttpStatus.SERVICE_UNAVAILABLE,
    'SERVICE_UNAVAILABLE',
    'Identity service is unavailable, try again later',
  );
}

/**
 * Typed gateway → Identity client (ADR-0005). Controllers never use the
 * ClientProxy directly, so the transport can change behind this class.
 */
@Injectable()
export class IdentityClient implements OnApplicationShutdown {
  private readonly logger = new Logger(IdentityClient.name);

  constructor(
    @Inject(IDENTITY_PROXY) private readonly proxy: ClientProxy,
    @Inject(RPC_TIMEOUT_MS) private readonly timeoutMs: number,
  ) {}

  /** Resolves with Identity's response; rejects with an HttpException. */
  async call<P extends IdentityRpcPattern>(
    pattern: P,
    data: IdentityRpcContract[P]['request'],
    context: CallContext,
  ): Promise<IdentityRpcContract[P]['response']> {
    const message: RpcRequest<IdentityRpcContract[P]['request']> = {
      correlationId: context.correlationId,
      ...(context.accessToken ? { accessToken: context.accessToken } : {}),
      data,
    };
    try {
      return await lastValueFrom(
        this.proxy.send(pattern, message).pipe(timeout(this.timeoutMs)),
        // void handlers (logout, delete) complete without a value.
        { defaultValue: undefined as IdentityRpcContract[P]['response'] },
      );
    } catch (err) {
      const mapped = toHttpError(err);
      if (mapped.getStatus() === HttpStatus.SERVICE_UNAVAILABLE) {
        // Never log `err` itself: it may carry the request.
        this.logger.error(
          `Identity call ${pattern} failed: ${err instanceof TimeoutError ? 'timeout' : ((err as { code?: string })?.code ?? (err as Error)?.name ?? 'unknown')} (correlationId=${context.correlationId})`,
        );
      }
      throw mapped;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.proxy.close();
  }
}
