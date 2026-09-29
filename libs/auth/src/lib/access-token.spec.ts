import {
  SignJWT,
  base64url,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  type CryptoKey,
} from 'jose';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  InvalidAccessTokenError,
  createAccessTokenSigner,
  createAccessTokenVerifier,
  pemFromEnv,
  type AccessTokenVerifier,
} from './access-token';

const KEY_ID = 'test-key-1';
const USER_ID = '3f1c9a52-6a8e-4b8a-9d61-0c0f2f5f7a11';

async function keyPair() {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', {
    crv: 'Ed25519',
    extractable: true,
  });
  return {
    privateKey,
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
  };
}

describe('access tokens', () => {
  let keys: Awaited<ReturnType<typeof keyPair>>;
  let otherKeys: Awaited<ReturnType<typeof keyPair>>;
  let verifier: AccessTokenVerifier;

  beforeAll(async () => {
    keys = await keyPair();
    otherKeys = await keyPair();
    verifier = await createAccessTokenVerifier({
      publicKeyPem: keys.publicKeyPem,
      keyId: KEY_ID,
    });
  });

  const sign = async (now?: Date) =>
    (
      await createAccessTokenSigner({
        privateKeyPem: keys.privateKeyPem,
        keyId: KEY_ID,
      })
    ).sign(USER_ID, now);

  /** Builds a token by hand to test claims the real signer never produces. */
  const craft = (
    key: CryptoKey,
    edit: (jwt: SignJWT) => SignJWT = (j) => j,
    header: { alg: string; kid?: string } = { alg: 'EdDSA', kid: KEY_ID },
  ) => {
    const now = Math.floor(Date.now() / 1000);
    return edit(
      new SignJWT({})
        .setProtectedHeader(header)
        .setIssuer('borrowbox-identity')
        .setAudience('borrowbox')
        .setSubject(USER_ID)
        .setJti('jti-1')
        .setIssuedAt(now)
        .setExpirationTime(now + 60),
    ).sign(key);
  };

  const rejects = (token: string, now?: Date) =>
    expect(verifier.verify(token, now)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );

  it('round-trips: signed by Identity, verified with the public key', async () => {
    const { token, expiresAt } = await sign();
    const user = await verifier.verify(token);
    expect(user.userId).toBe(USER_ID);
    expect(user.tokenId).toMatch(/^[0-9a-f-]{36}$/);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(
      (ACCESS_TOKEN_TTL_SECONDS - 5) * 1000,
    );
  });

  it('expires after 15 minutes, with 30 s clock tolerance', async () => {
    const issued = new Date('2026-01-01T10:00:00Z');
    const { token } = await sign(issued);
    const at = (s: number) => new Date(issued.getTime() + s * 1000);

    await expect(verifier.verify(token, at(15 * 60 + 29))).resolves.toEqual(
      expect.objectContaining({ userId: USER_ID }),
    );
    await rejects(token, at(15 * 60 + 31));
  });

  it('rejects a token signed with another key', async () => {
    await rejects(await craft(otherKeys.privateKey));
  });

  it('rejects an unknown key id', async () => {
    await rejects(
      await craft(keys.privateKey, undefined, { alg: 'EdDSA', kid: 'other' }),
    );
  });

  it('rejects the wrong audience or issuer', async () => {
    await rejects(await craft(keys.privateKey, (j) => j.setAudience('x')));
    await rejects(await craft(keys.privateKey, (j) => j.setIssuer('x')));
  });

  it('rejects a tampered payload', async () => {
    const { token } = await sign();
    const [header, , signature] = token.split('.');
    const forged = base64url.encode(
      JSON.stringify({ sub: 'someone-else', exp: 9999999999 }),
    );
    await rejects(`${header}.${forged}.${signature}`);
  });

  it('rejects alg "none" and symmetric algorithms', async () => {
    const payload = base64url.encode(JSON.stringify({ sub: USER_ID }));
    const none = base64url.encode(JSON.stringify({ alg: 'none' }));
    await rejects(`${none}.${payload}.`);

    const hs = await new SignJWT({ sub: USER_ID })
      .setProtectedHeader({ alg: 'HS256', kid: KEY_ID })
      .sign(new TextEncoder().encode(keys.publicKeyPem));
    await rejects(hs);
  });

  it('rejects garbage', async () => {
    await rejects('not-a-jwt');
  });
});

describe('pemFromEnv', () => {
  it('restores escaped newlines and requires a value', () => {
    expect(pemFromEnv('a\\nb', 'X')).toBe('a\nb');
    expect(() => pemFromEnv(undefined, 'JWT_PUBLIC_KEY')).toThrow(
      'JWT_PUBLIC_KEY is not set',
    );
  });
});
