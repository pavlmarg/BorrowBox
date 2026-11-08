import {
  decideRefresh,
  generateRefreshToken,
  hashRefreshToken,
  isWellFormedRefreshToken,
  type StoredRefreshToken,
} from './refresh-token';

const now = new Date('2026-06-01T12:00:00Z');
const live: StoredRefreshToken = {
  expires_at: new Date('2026-06-30T12:00:00Z'),
  rotated_at: null,
  revoked_at: null,
  user_deleted_at: null,
};

describe('refresh tokens', () => {
  it('are 256-bit, unique, well-formed and hashed with SHA-256', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(isWellFormedRefreshToken(a)).toBe(true);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(hashRefreshToken(a)).toHaveLength(32);
    expect(hashRefreshToken(a).equals(hashRefreshToken(a))).toBe(true);
  });

  it.each([undefined, 42, '', 'short', 'a'.repeat(44), 'a'.repeat(42) + '='])(
    'rejects malformed %p',
    (t) => expect(isWellFormedRefreshToken(t)).toBe(false),
  );
});

describe('decideRefresh', () => {
  it('rotates a live token', () => {
    expect(decideRefresh(live, now)).toBe('rotate');
  });

  const rotatedAgo = (ms: number) => new Date(now.getTime() - ms);

  it('treats a revoked token, or one rotated 30 s ago or more, as reuse, even if expired', () => {
    expect(decideRefresh({ ...live, revoked_at: now }, now)).toBe('reuse');
    expect(
      decideRefresh({ ...live, rotated_at: now, revoked_at: now }, now),
    ).toBe('reuse');
    expect(
      decideRefresh({ ...live, rotated_at: rotatedAgo(30_000) }, now),
    ).toBe('reuse');
    expect(
      decideRefresh(
        { ...live, rotated_at: rotatedAgo(60_000), expires_at: new Date(0) },
        now,
      ),
    ).toBe('reuse');
  });

  it('reissues a token rotated less than 30 s ago (a lost answer, retried)', () => {
    expect(decideRefresh({ ...live, rotated_at: now }, now)).toBe('reissue');
    expect(
      decideRefresh({ ...live, rotated_at: rotatedAgo(29_999) }, now),
    ).toBe('reissue');
    // Still bounded by the session's lifetime and the account.
    expect(
      decideRefresh({ ...live, rotated_at: now, expires_at: now }, now),
    ).toBe('expired');
    expect(
      decideRefresh({ ...live, rotated_at: now, user_deleted_at: now }, now),
    ).toBe('expired');
  });

  it('expires at expires_at exactly', () => {
    expect(decideRefresh({ ...live, expires_at: now }, now)).toBe('expired');
    expect(
      decideRefresh({ ...live, expires_at: new Date(now.getTime() + 1) }, now),
    ).toBe('rotate');
  });

  it('rejects tokens of deleted accounts', () => {
    expect(decideRefresh({ ...live, user_deleted_at: now }, now)).toBe(
      'expired',
    );
  });
});
