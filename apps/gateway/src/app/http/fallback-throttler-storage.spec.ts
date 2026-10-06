import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { FallbackThrottlerStorage } from './fallback-throttler-storage';

const record = (totalHits: number) => ({
  totalHits,
  timeToExpire: 60,
  isBlocked: false,
  timeToBlockExpire: 0,
});

describe('FallbackThrottlerStorage', () => {
  const redis = { status: 'ready' as string };
  let shared: jest.Mocked<ThrottlerStorage>;
  let fallback: jest.Mocked<ThrottlerStorage>;
  let storage: FallbackThrottlerStorage;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  const hit = () => storage.increment('ip-key', 60_000, 10, 0, 'default');

  beforeEach(() => {
    redis.status = 'ready';
    shared = { increment: jest.fn().mockResolvedValue(record(1)) };
    fallback = { increment: jest.fn().mockResolvedValue(record(2)) };
    storage = new FallbackThrottlerStorage(redis as never, shared, fallback);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('counts in Redis while it is healthy', async () => {
    expect(await hit()).toEqual(record(1));
    expect(fallback.increment).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('counts in memory when Redis is not connected, without trying it', async () => {
    redis.status = 'reconnecting';
    expect(await hit()).toEqual(record(2));
    expect(shared.increment).not.toHaveBeenCalled();
  });

  it('counts in memory when a Redis call fails', async () => {
    shared.increment.mockRejectedValue(
      Object.assign(new Error('Stream not writeable'), { code: 'ECONNRESET' }),
    );
    expect(await hit()).toEqual(record(2));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNRESET'));
  });

  it('logs once per switch and returns to Redis when it recovers', async () => {
    redis.status = 'reconnecting';
    await hit();
    await hit();
    expect(warn).toHaveBeenCalledTimes(1);

    redis.status = 'ready';
    expect(await hit()).toEqual(record(1));
    await hit();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'Rate limiting is shared through Redis again',
    );
  });
});
