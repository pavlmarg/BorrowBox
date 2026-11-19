import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { BookingsConfig } from '../config';
import { HandoffStore, HandoffStoreUnavailable } from './handoff-store';
import { codeFor, HandoffTokens } from './handoff-token';

function ed25519Pem(): string {
  return generateKeyPairSync('ed25519').privateKey.export({
    type: 'pkcs8',
    format: 'pem',
  }) as string;
}

describe('HandoffTokens', () => {
  const tokens = new HandoffTokens(ed25519Pem());
  const bookingId = randomUUID();
  const now = new Date('2026-12-01T10:00:00Z');

  it('issues a token that reads back with its claims for 45 seconds', () => {
    const issued = tokens.issue(bookingId, 'PICKUP', now);
    expect(issued.token).toMatch(/^v1\.[\w-]+\.[\w-]{86}$/);
    expect(issued.token.length).toBeLessThan(256);
    expect(issued.code).toMatch(/^\d{6}$/);
    expect(issued.expiresAt).toEqual(new Date('2026-12-01T10:00:45Z'));

    expect(tokens.read(issued.token, new Date('2026-12-01T10:00:44Z'))).toEqual(
      {
        bookingId,
        phase: 'PICKUP',
        nonce: issued.nonce,
        expiresAt: issued.expiresAt,
      },
    );
    expect(tokens.read(issued.token, issued.expiresAt)).toBe('EXPIRED');
  });

  it('gives every token its own nonce and code', () => {
    const a = tokens.issue(bookingId, 'RETURN', now);
    const b = tokens.issue(bookingId, 'RETURN', now);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.token).not.toBe(b.token);
  });

  it('refuses tampered, foreign and malformed tokens', () => {
    const { token } = tokens.issue(bookingId, 'PICKUP', now);
    const [v, body, sig] = token.split('.');
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, ph: 'r' })).toString(
      'base64url',
    );

    expect(tokens.read(`${v}.${forged}.${sig}`, now)).toBe('INVALID');
    expect(new HandoffTokens(ed25519Pem()).read(token, now)).toBe('INVALID');
    expect(tokens.read(`v2.${body}.${sig}`, now)).toBe('INVALID');
    expect(tokens.read('not a token', now)).toBe('INVALID');
    expect(tokens.read('', now)).toBe('INVALID');
  });

  it('refuses keys that are not Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    expect(() => new HandoffTokens(rsa)).toThrow(/Ed25519/);
  });

  it('derives the code from the signature, zero-padded', () => {
    expect(codeFor(Buffer.alloc(64))).toBe(codeFor(Buffer.alloc(64)));
    expect(codeFor(Buffer.alloc(64))).toMatch(/^\d{6}$/);
  });
});

describe('HandoffStore', () => {
  it('fails closed when Redis is unreachable', async () => {
    const config = {
      get: () => 'redis://:secret@127.0.0.1:1',
    } as unknown as ConfigService<BookingsConfig, true>;
    const store = new HandoffStore(config);
    try {
      await expect(store.spendNonce('n'.repeat(22))).rejects.toBeInstanceOf(
        HandoffStoreUnavailable,
      );
      await expect(
        store.saveCode(randomUUID(), 'PICKUP', '123456', 'v1.a.b'),
      ).rejects.toBeInstanceOf(HandoffStoreUnavailable);
    } finally {
      await store.beforeApplicationShutdown();
    }
  });
});
