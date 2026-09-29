import { Throttle } from '@nestjs/throttler';

const MINUTE = 60_000;

/** Default for every route, per client IP. */
export const DEFAULT_LIMIT = { limit: 120, ttl: MINUTE };

/** Credential-guessing targets: login, register, Google sign-in. */
export const AuthRateLimit = () =>
  Throttle({ default: { limit: 10, ttl: MINUTE } });

export const RefreshRateLimit = () =>
  Throttle({ default: { limit: 30, ttl: MINUTE } });
