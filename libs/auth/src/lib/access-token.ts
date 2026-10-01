import {
  SignJWT,
  errors as joseErrors,
  importPKCS8,
  importSPKI,
  jwtVerify,
  type CryptoKey,
} from 'jose';

/** Ed25519 signatures (ARCHITECTURE.md §3 Identity: asymmetric, verifiable with the public key). */
export const ACCESS_TOKEN_ALG = 'EdDSA';
export const ACCESS_TOKEN_ISSUER = 'borrowbox-identity';
export const ACCESS_TOKEN_AUDIENCE = 'borrowbox';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Allowed clock skew between Identity and the verifying service. */
export const CLOCK_TOLERANCE_SECONDS = 30;

/** The authenticated caller, as seen by the gateway and services. */
export interface AuthUser {
  userId: string;
  /** The token's `jti`; handy for logs and future revocation lists. */
  tokenId: string;
  /** The sign-in session (`sid`, Identity's refresh-token family) the token was issued for. */
  sessionId: string;
}

export interface AccessTokenSubject {
  userId: string;
  sessionId: string;
}

/** Thrown for any token that must not be trusted. The message is safe to log; the token is never included. */
export class InvalidAccessTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid access token: ${reason}`);
    this.name = 'InvalidAccessTokenError';
  }
}

export interface AccessTokenSignerOptions {
  /** PKCS#8 PEM of the Ed25519 private key. Identity only. */
  privateKeyPem: string;
  keyId: string;
}

export interface SignedAccessToken {
  token: string;
  expiresAt: Date;
}

export interface AccessTokenSigner {
  sign(subject: AccessTokenSubject, now?: Date): Promise<SignedAccessToken>;
}

export async function createAccessTokenSigner(
  options: AccessTokenSignerOptions,
): Promise<AccessTokenSigner> {
  const key = await importPKCS8(options.privateKeyPem, ACCESS_TOKEN_ALG);
  return {
    async sign({ userId, sessionId }, now = new Date()) {
      const iat = Math.floor(now.getTime() / 1000);
      const exp = iat + ACCESS_TOKEN_TTL_SECONDS;
      const token = await new SignJWT({ sid: sessionId })
        .setProtectedHeader({ alg: ACCESS_TOKEN_ALG, kid: options.keyId })
        .setIssuer(ACCESS_TOKEN_ISSUER)
        .setAudience(ACCESS_TOKEN_AUDIENCE)
        .setSubject(userId)
        .setJti(globalThis.crypto.randomUUID())
        .setIssuedAt(iat)
        .setExpirationTime(exp)
        .sign(key);
      return { token, expiresAt: new Date(exp * 1000) };
    },
  };
}

export interface AccessTokenVerifierOptions {
  /** SPKI PEM of the Ed25519 public key. */
  publicKeyPem: string;
  /** Tokens must carry this `kid`; a different kid means a key we don't trust. */
  keyId: string;
}

export interface AccessTokenVerifier {
  /** @throws InvalidAccessTokenError */
  verify(token: string, now?: Date): Promise<AuthUser>;
}

export async function createAccessTokenVerifier(
  options: AccessTokenVerifierOptions,
): Promise<AccessTokenVerifier> {
  const key: CryptoKey = await importSPKI(
    options.publicKeyPem,
    ACCESS_TOKEN_ALG,
  );
  return {
    async verify(token, now) {
      try {
        const { payload, protectedHeader } = await jwtVerify(token, key, {
          algorithms: [ACCESS_TOKEN_ALG],
          issuer: ACCESS_TOKEN_ISSUER,
          audience: ACCESS_TOKEN_AUDIENCE,
          requiredClaims: ['sub', 'jti', 'sid', 'iat', 'exp'],
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
          currentDate: now,
        });
        if (protectedHeader.kid !== options.keyId) {
          throw new InvalidAccessTokenError('unknown key id');
        }
        if (typeof payload['sid'] !== 'string') {
          throw new InvalidAccessTokenError('invalid sid');
        }
        return {
          userId: payload.sub as string,
          tokenId: payload.jti as string,
          sessionId: payload['sid'],
        };
      } catch (err) {
        if (err instanceof InvalidAccessTokenError) throw err;
        if (err instanceof joseErrors.JOSEError) {
          throw new InvalidAccessTokenError(err.code);
        }
        throw err;
      }
    },
  };
}

/**
 * Env vars can't hold real newlines everywhere (.env files, CI secrets), so
 * PEMs may be stored with literal `\n`. Restores them.
 */
export function pemFromEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not set`);
  return value.replace(/\\n/g, '\n');
}
