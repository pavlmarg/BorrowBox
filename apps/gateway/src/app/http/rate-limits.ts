import { Throttle } from '@nestjs/throttler';

const MINUTE = 60_000;

/** Default for every route, per client IP. */
export const DEFAULT_LIMIT = { limit: 120, ttl: MINUTE };

/** Credential-guessing targets: login, register, Google sign-in. */
export const AuthRateLimit = () =>
  Throttle({ default: { limit: 10, ttl: MINUTE } });

export const RefreshRateLimit = () =>
  Throttle({ default: { limit: 30, ttl: MINUTE } });

/**
 * Search as you type: one request per pause in typing, so bursts of a few
 * per second are normal (G6).
 */
export const SuggestRateLimit = () =>
  Throttle({ default: { limit: 300, ttl: MINUTE } });
