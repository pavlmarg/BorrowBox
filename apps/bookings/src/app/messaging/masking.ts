/**
 * Hides contact details in chat until a booking goes ahead (ADR-0017):
 * email addresses, links and phone numbers become `•••`. This is friction,
 * not security: spelled-out numbers, short numbers and numbers written with
 * dots or slashes get through. In exchange, dates, prices and ordinary words
 * are never hidden.
 */

export const MASK = '•••';

const EMAIL = /[\p{L}0-9._%+-]+@[\p{L}0-9-]+(?:\.[\p{L}0-9-]+)+/giu;
const URL = /\b(?:https?:\/\/|www\.)[^\s]+/giu;
/**
 * Bare domains, e.g. `maria.gr/shop`. Only endings that don't also follow a
 * sentence typed without a space ("Thanks.It works", "call.me later").
 */
const DOMAIN =
  /\b[\p{L}0-9-]+(?:\.[\p{L}0-9-]+)*\.(?:com|net|org|gr|eu|info|biz|cy)\b(?:\/[^\s]*)?/giu;
/**
 * Ten or more digits (a Greek number without the country code has ten),
 * with at most three spaces, dashes or brackets between two digits. Dots and
 * slashes break a number, so dates like 21/11/2026 - 23/11/2026 stay.
 */
const PHONE = /(?:\+|00|\()?\d(?:[\s()-]{0,3}\d){9,}/gu;

export function maskContacts(text: string): string {
  return text
    .replace(EMAIL, MASK)
    .replace(URL, MASK)
    .replace(DOMAIN, MASK)
    .replace(PHONE, MASK);
}
