import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  HANDOFF_CODE_WINDOW_SECONDS,
  HANDOFF_TOKEN_TTL_SECONDS,
  type HandoffPhase,
} from '@borrowbox/contracts';
import type { BookingsConfig } from '../config';

/** Redis didn't answer: the scan is refused, never let through unchecked. */
export class HandoffStoreUnavailable extends Error {
  constructor() {
    super('Handoff store unavailable');
    this.name = 'HandoffStoreUnavailable';
  }
}

/** A spent nonce is kept a little longer than any token lives. */
const NONCE_TTL_SECONDS = HANDOFF_TOKEN_TTL_SECONDS + 75;

/**
 * Redis for the handoff (ARCHITECTURE.md §5, ADR-0026): single-use nonces
 * (`SET NX`), the 6-digit codes of live tokens, and wrong-code counts.
 * Fails closed: every Redis error becomes `HandoffStoreUnavailable`.
 * Keys hold ids and tokens only, never personal data.
 */
@Injectable()
export class HandoffStore implements BeforeApplicationShutdown {
  private readonly redis: Redis;
  private connecting?: Promise<void>;

  constructor(config: ConfigService<BookingsConfig, true>) {
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 2_000,
    });
    this.redis.on('error', () => undefined);
  }

  /** Remembers a token's code until the token expires. */
  async saveCode(
    bookingId: string,
    phase: HandoffPhase,
    code: string,
    token: string,
  ): Promise<void> {
    await this.run((r) =>
      r.set(
        codeKey(bookingId, phase, code),
        token,
        'EX',
        HANDOFF_TOKEN_TTL_SECONDS,
      ),
    );
  }

  /** The live token behind a typed code, or null. */
  async tokenForCode(
    bookingId: string,
    phase: HandoffPhase,
    code: string,
  ): Promise<string | null> {
    return this.run((r) => r.get(codeKey(bookingId, phase, code)));
  }

  /** Spends a nonce. @returns false if it was already spent */
  async spendNonce(nonce: string): Promise<boolean> {
    const ok = await this.run((r) =>
      r.set(`handoff:nonce:${nonce}`, '1', 'EX', NONCE_TTL_SECONDS, 'NX'),
    );
    return ok === 'OK';
  }

  /** Counts a wrong code. @returns the count in the current window */
  async countWrongCode(
    bookingId: string,
    phase: HandoffPhase,
  ): Promise<number> {
    const key = `handoff:attempts:${bookingId}:${phase}`;
    return this.run(async (r) => {
      const [[, count]] = (await r
        .multi()
        .incr(key)
        .expire(key, HANDOFF_CODE_WINDOW_SECONDS, 'NX')
        .exec()) as [[Error | null, number], unknown];
      return count;
    });
  }

  /** Wrong codes in the current window, without counting one. */
  async wrongCodes(bookingId: string, phase: HandoffPhase): Promise<number> {
    const value = await this.run((r) =>
      r.get(`handoff:attempts:${bookingId}:${phase}`),
    );
    return value ? Number(value) : 0;
  }

  private async run<T>(command: (redis: Redis) => Promise<T>): Promise<T> {
    try {
      if (this.redis.status === 'wait' || this.redis.status === 'end') {
        this.connecting ??= this.redis.connect().finally(() => {
          this.connecting = undefined;
        });
      }
      await this.connecting;
      return await command(this.redis);
    } catch {
      throw new HandoffStoreUnavailable();
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
  }
}

function codeKey(bookingId: string, phase: HandoffPhase, code: string): string {
  return `handoff:code:${bookingId}:${phase}:${code}`;
}
