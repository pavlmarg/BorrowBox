import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

/**
 * Rate-limit counters in Redis (shared by every gateway instance), with an
 * in-memory backup while Redis is unreachable, so the limits stay in force
 * and the API keeps answering instead of failing every request.
 *
 * In local mode each instance counts on its own (with N instances a client
 * gets up to N× the limit), and counters start afresh at each switch.
 */
export class FallbackThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly logger = new Logger('RateLimit');
  private local = false;

  constructor(
    private readonly redis: Pick<Redis, 'status'>,
    private readonly shared: ThrottlerStorage,
    private readonly fallback: ThrottlerStorage &
      Partial<OnApplicationShutdown>,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // Not 'ready' means ioredis would fail anyway (no offline queue): skip the attempt.
    if (this.redis.status === 'ready') {
      try {
        const record = await this.shared.increment(
          key,
          ttl,
          limit,
          blockDuration,
          throttlerName,
        );
        this.useShared();
        return record;
      } catch (err) {
        this.useLocal(err);
      }
    } else {
      this.useLocal();
    }
    return this.fallback.increment(
      key,
      ttl,
      limit,
      blockDuration,
      throttlerName,
    );
  }

  onApplicationShutdown(): void {
    this.fallback.onApplicationShutdown?.();
  }

  /** Logs once per switch, not per request. Never logs keys (they contain client IPs). */
  private useLocal(err?: unknown): void {
    if (this.local) return;
    this.local = true;
    const reason =
      err === undefined
        ? 'Redis not connected'
        : ((err as { code?: string })?.code ?? (err as Error)?.name ?? 'error');
    this.logger.warn(
      `Rate limiting uses in-memory counters on this instance (${reason})`,
    );
  }

  private useShared(): void {
    if (!this.local) return;
    this.local = false;
    this.logger.log('Rate limiting is shared through Redis again');
  }
}
