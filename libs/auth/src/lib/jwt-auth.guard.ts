import {
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import type { RpcErrorBody, RpcRequest } from '@borrowbox/contracts';
import {
  InvalidAccessTokenError,
  type AccessTokenVerifier,
  type AuthUser,
} from './access-token';

export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

interface HttpRequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

/** RPC callers, keyed by the incoming message object (no mutation of the payload). */
const rpcUsers = new WeakMap<object, AuthUser>();

/**
 * Gateway (HTTP): requires `Authorization: Bearer <access token>` and exposes
 * the caller through `@CurrentUser()`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      throw new Error('JwtAuthGuard is for HTTP; use RpcJwtAuthGuard');
    }
    const request = context.switchToHttp().getRequest<HttpRequestWithUser>();
    const token = bearerToken(request.headers['authorization']);
    if (!token) throw new UnauthorizedException();
    try {
      request.user = await this.verifier.verify(token);
      return true;
    } catch (err) {
      if (err instanceof InvalidAccessTokenError) {
        throw new UnauthorizedException();
      }
      throw err;
    }
  }
}

/**
 * Services (NestJS TCP, ADR-0005): re-verifies `RpcRequest.accessToken` sent by
 * the gateway (defence in depth) and exposes the caller through `@CurrentUser()`.
 * Rejects with `RpcErrorBody { code: 'UNAUTHENTICATED' }`.
 */
@Injectable()
export class RpcJwtAuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'rpc') {
      throw new Error('RpcJwtAuthGuard is for RPC; use JwtAuthGuard');
    }
    const message = context
      .switchToRpc()
      .getData<Partial<RpcRequest<unknown>> | null>();
    const token = message?.accessToken;
    if (!message || typeof token !== 'string') throw unauthenticated();
    try {
      rpcUsers.set(message, await this.verifier.verify(token));
      return true;
    } catch (err) {
      if (err instanceof InvalidAccessTokenError) throw unauthenticated();
      throw err;
    }
  }
}

function unauthenticated(): RpcException {
  const body: RpcErrorBody<'UNAUTHENTICATED'> = {
    code: 'UNAUTHENTICATED',
    message: 'Authentication required',
  };
  return new RpcException(body);
}

function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match =
    /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header);
  return match ? match[1] : null;
}

/** The caller set by `JwtAuthGuard` / `RpcJwtAuthGuard`. Only use on guarded handlers. */
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser => {
    const user =
      context.getType() === 'rpc'
        ? rpcUsers.get(context.switchToRpc().getData<object>())
        : context.switchToHttp().getRequest<HttpRequestWithUser>().user;
    if (!user) {
      throw new Error('@CurrentUser() used on a handler without an auth guard');
    }
    return user;
  },
);
