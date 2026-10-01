import { startRedis, type TestRedis } from './redis';

describe('startRedis', () => {
  let redis: TestRedis;

  beforeAll(async () => {
    redis = await startRedis();
  });

  afterAll(async () => {
    await redis?.stop();
  });

  it('requires the password, like infra/docker-compose.yml', async () => {
    expect(redis.url).toMatch(/^redis:\/\/:[^@]+@/);
    const authed = await redis.container.exec([
      'redis-cli',
      '-a',
      redis.container.getPassword(),
      '--no-auth-warning',
      'ping',
    ]);
    expect(authed.output).toContain('PONG');

    const anonymous = await redis.container.exec(['redis-cli', 'ping']);
    expect(anonymous.output).toContain('NOAUTH');
  });
});
