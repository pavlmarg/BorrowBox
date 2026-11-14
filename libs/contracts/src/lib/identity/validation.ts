import { hasContactDetails } from '../messaging/contacts';

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
/**
 * The public bio (ADR-0025): a short note shown on the profile and the
 * lender's item pages ("Message me after 9"). Counted in characters.
 */
export const BIO_MAX_LENGTH = 150;
export const BIO_MAX_LINES = 3;

/** Why a bio is refused (after `normaliseBio`), or null if it is fine. */
export type BioProblem = 'TOO_LONG' | 'TOO_MANY_LINES' | 'CONTACT_DETAILS';

/** Trimmed, with Windows and old Mac line breaks made `\n`. */
export function normaliseBio(bio: string): string {
  return bio.replace(/\r\n?/g, '\n').trim();
}

/**
 * Checks a normalised bio. Phone numbers, emails and links are refused, so
 * a bio can't hand out what chat hides until a booking (ADR-0017).
 */
export function bioProblem(bio: string): BioProblem | null {
  if ([...bio].length > BIO_MAX_LENGTH) return 'TOO_LONG';
  if (bio.split('\n').length > BIO_MAX_LINES) return 'TOO_MANY_LINES';
  if (hasContactDetails(bio)) return 'CONTACT_DETAILS';
  return null;
}

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
