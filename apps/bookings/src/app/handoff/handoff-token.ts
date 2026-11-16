import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import {
  HANDOFF_CODE_LENGTH,
  HANDOFF_TOKEN_TTL_SECONDS,
  type HandoffPhase,
} from '@borrowbox/contracts';

/**
 * The QR token (ARCHITECTURE.md §5, ADR-0026):
 * `v1.<base64url JSON { b, ph, n, exp }>.<base64url Ed25519 signature>`,
 * signature over everything before the last dot. Short, so the QR code
 * stays easy to scan; only Bookings reads it.
 */
export interface HandoffClaims {
  bookingId: string;
  phase: HandoffPhase;
  /** Single use: spent in Redis when scanned. */
  nonce: string;
  expiresAt: Date;
}

export interface IssuedToken extends HandoffClaims {
  token: string;
  code: string;
}

const PHASE_TO_WIRE: Record<HandoffPhase, string> = {
  PICKUP: 'p',
  RETURN: 'r',
};
const WIRE_TO_PHASE: Record<string, HandoffPhase> = {
  p: 'PICKUP',
  r: 'RETURN',
};

const TOKEN_PATTERN = /^v1\.([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{86})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{22}$/;

export class HandoffTokens {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(privateKeyPem: string) {
    this.privateKey = createPrivateKey(privateKeyPem);
    if (this.privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('HANDOFF_PRIVATE_KEY must be an Ed25519 key');
    }
    this.publicKey = createPublicKey(this.privateKey);
  }

  /** A fresh token for the person showing the code, valid 45 seconds. */
  issue(bookingId: string, phase: HandoffPhase, now = new Date()): IssuedToken {
    const nonce = randomBytes(16).toString('base64url');
    const exp = Math.floor(now.getTime() / 1000) + HANDOFF_TOKEN_TTL_SECONDS;
    const body = Buffer.from(
      JSON.stringify({ b: bookingId, ph: PHASE_TO_WIRE[phase], n: nonce, exp }),
    ).toString('base64url');
    const signed = `v1.${body}`;
    const signature = sign(null, Buffer.from(signed), this.privateKey);
    return {
      token: `${signed}.${signature.toString('base64url')}`,
      code: codeFor(signature),
      bookingId,
      phase,
      nonce,
      expiresAt: new Date(exp * 1000),
    };
  }

  /**
   * Checks the signature first, then the claims' shape and expiry.
   * `INVALID` for anything not one of ours; never says which check failed.
   */
  read(token: string, now = new Date()): HandoffClaims | 'INVALID' | 'EXPIRED' {
    const match = TOKEN_PATTERN.exec(token);
    if (!match) return 'INVALID';
    const [, body, sig] = match;
    const signature = Buffer.from(sig, 'base64url');
    if (!verify(null, Buffer.from(`v1.${body}`), this.publicKey, signature)) {
      return 'INVALID';
    }
    let claims: { b?: unknown; ph?: unknown; n?: unknown; exp?: unknown };
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return 'INVALID';
    }
    const phase =
      typeof claims.ph === 'string' ? WIRE_TO_PHASE[claims.ph] : undefined;
    if (
      typeof claims.b !== 'string' ||
      !UUID.test(claims.b) ||
      !phase ||
      typeof claims.n !== 'string' ||
      !NONCE.test(claims.n) ||
      typeof claims.exp !== 'number' ||
      !Number.isInteger(claims.exp)
    ) {
      return 'INVALID';
    }
    const expiresAt = new Date(claims.exp * 1000);
    if (expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
    return { bookingId: claims.b, phase, nonce: claims.n, expiresAt };
  }
}

/** The 6-digit fallback: the first 32 bits of SHA-256(signature), mod 10⁶. */
export function codeFor(signature: Buffer): string {
  const n = createHash('sha256').update(signature).digest().readUInt32BE(0);
  return String(n % 10 ** HANDOFF_CODE_LENGTH).padStart(
    HANDOFF_CODE_LENGTH,
    '0',
  );
}
