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
