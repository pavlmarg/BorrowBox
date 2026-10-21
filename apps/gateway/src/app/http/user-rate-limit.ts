import {
  applyDecorators,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerStorage,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthUser } from '@borrowbox/auth';
import { apiError } from './api-error';

interface UserLimit {
  /** Counter name, e.g. `messages`; routes sharing a name share the count. */
  name: string;
  limit: number;
  ttlMs: number;
}

const USER_LIMIT = Symbol('USER_LIMIT');

/**
 * Counts per signed-in user (G2), in the same Redis store as the per-IP
 * limits (with its in-memory fallback). Runs after JwtAuthGuard, which sets
 * `request.user`; on top of the per-IP limit, never instead of it.
 */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<UserLimit | undefined>(
      USER_LIMIT,
      context.getHandler(),
    );
    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>().user;
    if (!rule || !user) return true;
    // Blocked until the window ends, like the per-IP limits (a zero block
    // duration is an invalid expiry for the Redis store).
    const { isBlocked } = await this.storage.increment(
      `user:${rule.name}:${user.userId}`,
      rule.ttlMs,
      rule.limit,
      rule.ttlMs,
      `user-${rule.name}`,
    );
    if (isBlocked) {
      throw apiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Too many requests, try again later',
      );
    }
    return true;
  }
}

/** At most `limit` calls per user within `ttlMs`, counted under `name`. */
export const UserRateLimit = (name: string, limit: number, ttlMs: number) =>
  applyDecorators(
    SetMetadata(USER_LIMIT, { name, limit, ttlMs } satisfies UserLimit),
    UseGuards(UserRateLimitGuard),
  );
