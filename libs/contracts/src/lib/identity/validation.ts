/**
 * Input rules shared by the PWA (form validation), the gateway (HTTP DTOs) and
 * Identity (RPC DTOs), so all three agree.
 */

export const PASSWORD_MIN_LENGTH = 8;
/** Allows passphrases and password-manager output while bounding hashing cost. */
export const PASSWORD_MAX_LENGTH = 64;
/** At least one letter and one digit (any script, e.g. Greek letters count). */
export const PASSWORD_RULE = /^(?=.*\p{L})(?=.*\p{Nd}).*$/u;

export const DISPLAY_NAME_MAX_LENGTH = 50;
/** RFC 5321 limit for a forward path. */
export const EMAIL_MAX_LENGTH = 254;

/** True if `password` satisfies the length and composition rules. */
export function isValidPassword(password: string): boolean {
  const length = [...password].length;
  return (
    length >= PASSWORD_MIN_LENGTH &&
    length <= PASSWORD_MAX_LENGTH &&
    PASSWORD_RULE.test(password)
  );
}

/**
 * Email-link tokens (verification, password reset; ADR-0016) are 32 random
 * bytes in base64url: exactly this many characters.
 */
export const EMAIL_TOKEN_LENGTH = 43;

/** True if `token` has an email-link token's shape (checked before any lookup). */
export function isWellFormedEmailToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    token.length === EMAIL_TOKEN_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(token)
  );
}

/** How long a verification link works. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a password-reset link works. */
export const PASSWORD_RESET_TTL_MS = 10 * 60 * 1000;
/**
 * At most one email of each kind per account in this time; further requests
 * succeed without sending, so they can't be used to flood an inbox.
 */
export const EMAIL_LINK_COOLDOWN_MS = 60 * 1000;
