/**
 * Hides contact details in chat until a booking goes ahead (ADR-0017):
 * email addresses, links and phone numbers become `•••`. This is friction,
 * not security: spelled-out numbers get through.
 */

export const MASK = '•••';

const EMAIL = /[\p{L}0-9._%+-]+@[\p{L}0-9-]+(?:\.[\p{L}0-9-]+)+/giu;
const URL = /\b(?:https?:\/\/|www\.)[^\s]+/giu;
/** Bare domains with a common top-level domain, e.g. `maria.gr/shop`. */
const DOMAIN =
  /\b[\p{L}0-9-]+(?:\.[\p{L}0-9-]+)*\.(?:com|net|org|gr|eu|io|me|info|biz|co|app|link|ly|uk|de|it|fr|es|cy)\b(?:\/[^\s]*)?/giu;
/** Seven or more digits, with spaces, dots, dashes, slashes or brackets between. */
const PHONE = /(?:\+|00|\()?\d(?:[\s().\-/]*\d){6,}/gu;

export function maskContacts(text: string): string {
  return text
    .replace(EMAIL, MASK)
    .replace(URL, MASK)
    .replace(DOMAIN, MASK)
    .replace(PHONE, MASK);
}
