import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { GatewayConfig } from './config';

export const REDIS = Symbol('REDIS');

/**
 * Shared Redis connection (rate-limit counters now; Socket.IO fan-out later).
 * Fails fast instead of queueing while Redis is down, so requests error
 * quickly rather than hang.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<GatewayConfig, true>) => {
        const redis = new Redis(config.get('REDIS_URL', { infer: true }), {
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
        // Without an 'error' listener ioredis prints "Unhandled error event"
        // on every reconnect attempt. Log once per outage instead; the
        // message never contains the URL or password.
        const logger = new Logger('Redis');
        let down = false;
        redis.on('error', (err: Error & { code?: string }) => {
          if (down) return;
          down = true;
          logger.error(`Redis unavailable (${err.code ?? err.name})`);
        });
        redis.on('ready', () => {
          if (down) logger.log('Redis connection restored');
          down = false;
        });
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end')
      await this.redis.quit().catch(() => undefined);
  }
}
