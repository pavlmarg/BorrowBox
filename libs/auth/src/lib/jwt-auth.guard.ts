import {
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
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

/**
 * Requires a valid `Authorization: Bearer <access token>` header and exposes
 * the caller through `@CurrentUser()`. HTTP only for now; the RPC variant for
 * services comes with the first service (Phase 1, step 5).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      throw new Error(
        `JwtAuthGuard does not support "${context.getType()}" yet`,
      );
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

function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match =
    /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header);
  return match ? match[1] : null;
}

/** The caller set by `JwtAuthGuard`. Only use on guarded handlers. */
export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser => {
    const user = context.switchToHttp().getRequest<HttpRequestWithUser>().user;
    if (!user) {
      throw new Error('@CurrentUser() used on a route without JwtAuthGuard');
    }
    return user;
  },
);
