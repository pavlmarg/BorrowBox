import { validateConfig } from './config';

const valid = {
  DATABASE_URL: 'postgres://identity_svc:secret-pw@localhost:5432/borrowbox',
  RABBITMQ_URL: 'amqp://borrowbox:secret-pw@localhost:5672',
  JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----',
  JWT_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
  JWT_KEY_ID: 'dev-1',
  PHOTOS_BASE_URL: 'http://localhost:8333/borrowbox-public/',
  REDIS_URL: 'redis://:secret-pw@localhost:6379',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_ACCESS_KEY_ID: 'borrowbox-identity',
  S3_SECRET_ACCESS_KEY: 'secret-pw',
  S3_UPLOADS_BUCKET: 'borrowbox-uploads',
  S3_PUBLIC_BUCKET: 'borrowbox-public',
};

describe('validateConfig', () => {
  it('applies defaults', () => {
    const config = validateConfig(valid);
    expect(config.IDENTITY_HOST).toBe('127.0.0.1');
    expect(config.IDENTITY_PORT).toBe(4001);
    expect(config.DB_MIGRATIONS_RUN).toBe(false);
    expect(config.S3_REGION).toBe('us-east-1');
    // Trailing slashes go, so photo URLs never get a double slash.
    expect(config.PHOTOS_BASE_URL).toBe(
      'http://localhost:8333/borrowbox-public',
    );
  });

  it('keeps Google sign-in optional, but needs the secret with the client id', () => {
    const config = validateConfig(valid);
    expect(config.GOOGLE_ISSUER).toBe('https://accounts.google.com');
    expect(config.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(
      validateConfig({
        ...valid,
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
      }).GOOGLE_CLIENT_ID,
    ).toBeUndefined();
    expect(() =>
      validateConfig({ ...valid, GOOGLE_CLIENT_ID: 'id.apps.example' }),
    ).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(
      validateConfig({
        ...valid,
        GOOGLE_CLIENT_ID: 'id.apps.example',
        GOOGLE_CLIENT_SECRET: 'secret-value',
      }).GOOGLE_CLIENT_ID,
    ).toBe('id.apps.example');
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
      'PHOTOS_BASE_URL',
      'REDIS_URL',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'S3_UPLOADS_BUCKET',
      'S3_PUBLIC_BUCKET',
    ]) {
      expect(message).toContain(name);
    }
    expect(message).not.toContain('secret-pw');
  });
});
