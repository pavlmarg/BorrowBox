import express from 'express';
import { parseTrustProxy, validateConfig } from './config';

const valid = {
  REDIS_URL: 'redis://:pw@localhost:6379',
  COOKIE_SECRET: 'x'.repeat(32),
  JWT_PUBLIC_KEY: 'placeholder',
  JWT_KEY_ID: 'placeholder',
};

/** Express's compiled trust check for a TRUST_PROXY value. */
function trusts(trustProxy: string, remoteAddress: string): boolean {
  const app = express();
  app.set('trust proxy', parseTrustProxy(trustProxy));
  const trust = app.get('trust proxy fn') as (
    addr: string,
    i: number,
  ) => boolean;
  return trust(remoteAddress, 0);
}

describe('TRUST_PROXY', () => {
  it('defaults to loopback, which trusts only a proxy on this host', () => {
    expect(validateConfig(valid).TRUST_PROXY).toBe('loopback');
    expect(trusts('loopback', '127.0.0.1')).toBe(true);
    expect(trusts('loopback', '::1')).toBe(true);
    expect(trusts('loopback', '172.18.0.5')).toBe(false);
  });

  it('trusts Caddy on a Docker network when its subnet is listed', () => {
    const value = 'loopback, 172.16.0.0/12';
    expect(parseTrustProxy(value)).toEqual(['loopback', '172.16.0.0/12']);
    expect(trusts(value, '172.18.0.5')).toBe(true);
    expect(trusts(value, '203.0.113.7')).toBe(false);
  });

  it.each([
    ['false', false],
    ['1', 1],
    ['uniquelocal,linklocal', ['uniquelocal', 'linklocal']],
    ['10.0.0.1,fd00::/8', ['10.0.0.1', 'fd00::/8']],
  ])('accepts %p', (value, parsed) => {
    expect(parseTrustProxy(value)).toEqual(parsed);
    expect(() =>
      validateConfig({ ...valid, TRUST_PROXY: value }),
    ).not.toThrow();
  });

  it.each([
    ['true (trusts every sender, so any client could fake its IP)', 'true'],
    ['too many hops', '11'],
    ['a hostname', 'caddy'],
    ['a bad prefix', '10.0.0.0/33'],
    ['an empty entry', 'loopback,'],
    ['empty', ''],
  ])('rejects %s without echoing the value', (_, value) => {
    let message = '';
    try {
      validateConfig({ ...valid, TRUST_PROXY: value });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/TRUST_PROXY must be/);
    if (value) expect(message).not.toContain(`"${value}"`);
  });
});
