import { validateConfig } from './config';

const valid = {
  DATABASE_URL: 'postgres://identity_svc:secret-pw@localhost:5432/borrowbox',
  RABBITMQ_URL: 'amqp://borrowbox:secret-pw@localhost:5672',
  JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----',
  JWT_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
  JWT_KEY_ID: 'dev-1',
};

describe('validateConfig', () => {
  it('applies defaults', () => {
    const config = validateConfig(valid);
    expect(config.IDENTITY_HOST).toBe('127.0.0.1');
    expect(config.IDENTITY_PORT).toBe(4001);
    expect(config.DB_MIGRATIONS_RUN).toBe(false);
  });

  it('parses port and boolean strings from env', () => {
    const config = validateConfig({
      ...valid,
      IDENTITY_PORT: '5001',
      DB_MIGRATIONS_RUN: 'true',
    });
    expect(config.IDENTITY_PORT).toBe(5001);
    expect(config.DB_MIGRATIONS_RUN).toBe(true);
    expect(
      validateConfig({ ...valid, DB_MIGRATIONS_RUN: 'false' })
        .DB_MIGRATIONS_RUN,
    ).toBe(false);
  });

  it('names every missing or invalid variable without echoing values', () => {
    let message = '';
    try {
      validateConfig({
        DATABASE_URL: 'mysql://x:secret-pw@h/db',
        IDENTITY_PORT: '99999',
      });
    } catch (err) {
      message = (err as Error).message;
    }
    for (const name of [
      'DATABASE_URL',
      'RABBITMQ_URL',
      'IDENTITY_PORT',
      'JWT_PUBLIC_KEY',
      'JWT_PRIVATE_KEY',
      'JWT_KEY_ID',
    ]) {
      expect(message).toContain(name);
    }
    expect(message).not.toContain('secret-pw');
  });
});
