import {
  UserDeletionRequestedV1,
  UserEmailVerifiedV1,
  UserRegisteredV1,
} from './events';
import { IdentityRpc, type IdentityRpcPattern } from './rpc';
import {
  GOOGLE_EXCHANGE_MAX_REQUESTS,
  GOOGLE_EXCHANGE_TIMEOUT_MS,
  GOOGLE_HTTP_TIMEOUT_MS,
} from './timeouts';
import {
  bioProblem,
  isValidPassword,
  isWellFormedEmailToken,
  normaliseBio,
} from './validation';

describe('bio rules', () => {
  it('normalises line breaks and trims', () => {
    expect(normaliseBio('  Hi\r\nthere\rfriend \n')).toBe('Hi\nthere\nfriend');
  });

  it('accepts a short note, up to 150 characters and 3 lines', () => {
    expect(bioProblem('Message only after 9 🙂')).toBeNull();
    expect(bioProblem('α'.repeat(150))).toBeNull();
    expect(bioProblem('one\ntwo\nthree')).toBeNull();
  });

  it.each([
    ['too long', 'a'.repeat(151), 'TOO_LONG'],
    ['too many lines', 'a\nb\nc\nd', 'TOO_MANY_LINES'],
    ['a phone number', 'Call 691 234 5678', 'CONTACT_DETAILS'],
    ['an email', 'maria@example.gr', 'CONTACT_DETAILS'],
    ['a link', 'www.maria.gr', 'CONTACT_DETAILS'],
  ])('refuses %s', (_, bio, problem) => expect(bioProblem(bio)).toBe(problem));
});

describe('Google sign-in timeouts', () => {
  it('give the gateway longer than every Google request Identity may make', () => {
    expect(GOOGLE_EXCHANGE_TIMEOUT_MS).toBeGreaterThan(
      GOOGLE_HTTP_TIMEOUT_MS * GOOGLE_EXCHANGE_MAX_REQUESTS,
    );
    // openid-client takes whole seconds.
    expect(GOOGLE_HTTP_TIMEOUT_MS % 1000).toBe(0);
  });
});

describe('isValidPassword', () => {
  it.each(['abcdefg1', 'correct horse 42', 'κωδικός9', 'a1'.repeat(32)])(
    'accepts %p',
    (p) => expect(isValidPassword(p)).toBe(true),
  );

  it.each([
    ['too short', 'abcdef1'],
    ['too long', 'a1'.repeat(32) + 'x'],
    ['no digit', 'abcdefgh'],
    ['no letter', '12345678'],
    ['digits and symbols only', '1234!@#$'],
  ])('rejects %s', (_, p) => expect(isValidPassword(p)).toBe(false));
});

describe('identity events', () => {
  it('use versioned routing keys', () => {
    expect(UserRegisteredV1.routingKey).toBe('user.registered.v1');
    expect(UserDeletionRequestedV1.routingKey).toBe(
      'user.deletion_requested.v1',
    );
    expect(UserEmailVerifiedV1.routingKey).toBe('user.email_verified.v1');
  });
});

describe('isWellFormedEmailToken', () => {
  it('accepts 43 base64url characters', () =>
    expect(isWellFormedEmailToken('a'.repeat(40) + '-_9')).toBe(true));

  it.each([
    ['too short', 'a'.repeat(42)],
    ['too long', 'a'.repeat(44)],
    ['other characters', 'a'.repeat(42) + '='],
    ['not a string', 42],
  ])('rejects %s', (_, t) => expect(isWellFormedEmailToken(t)).toBe(false));
});

describe('IdentityRpc patterns', () => {
  const patterns = Object.values(IdentityRpc);

  it('are unique and namespaced to identity', () => {
    expect(new Set(patterns).size).toBe(patterns.length);
    for (const p of patterns) expect(p).toMatch(/^identity\.[a-z.]+$/);
  });

  it('each have a contract entry', () => {
    // Compile-time check: every pattern is a key of IdentityRpcContract.
    const typed: IdentityRpcPattern[] = patterns;
    expect(typed).toHaveLength(18);
  });
});
