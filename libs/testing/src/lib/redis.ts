import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import { REDIS_IMAGE, STARTUP_TIMEOUT_MS } from './images';

export interface TestRedis {
  container: StartedRedisContainer;
  /** `redis://:<password>@host:port`, password-protected like `infra/docker-compose.yml`. */
  url: string;
  stop(): Promise<void>;
}

export async function startRedis(): Promise<TestRedis> {
  const container = await new RedisContainer(REDIS_IMAGE)
    .withPassword('redis-test-password')
    .withStartupTimeout(STARTUP_TIMEOUT_MS)
    .start();
  return {
    container,
    url: container.getConnectionUrl(),
    stop: async () => {
      await container.stop();
    },
  };
}
