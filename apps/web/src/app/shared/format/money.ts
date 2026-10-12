/**
 * Euro amounts. Money is always integer cents (CLAUDE.md); these helpers only
 * turn cents into text and back, never through floating-point arithmetic.
 */

/**
 * `550` → `5,50 €` (el-GR) or `€5.50` (en-GB). Whole amounts drop the
 * decimals: `500` → `5 €` / `€5`.
 */
export function formatCents(cents: number, locale: string): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// Digits, then optionally `,` or `.` and one or two digits. No thousands
// separators: "5.000" means 5 in English and 5000 in Greek, so it's refused.
const EUROS = /^(\d{1,7})(?:[.,](\d{1,2}))?$/;

/**
 * What someone typed → cents, or null if it isn't a plain amount. Accepts
 * `5`, `5,5`, `5,50`, `5.50`, with an optional `€` and spaces around it.
 */
export function parseEuros(text: string): number | null {
  const match = EUROS.exec(text.replace(/€/g, '').trim());
  if (!match) return null;
  const [, euros, fraction = ''] = match;
  return Number(euros) * 100 + Number(fraction.padEnd(2, '0'));
}

/**
 * Cents → text for an input field: `550` → `5,50` (el) or `5.50` (en);
 * whole amounts without decimals. No currency sign or grouping, so
 * {@link parseEuros} reads it back.
 */
export function centsToInput(cents: number, locale: string): string {
  const euros = Math.trunc(cents / 100);
  const rest = cents % 100;
  if (rest === 0) return String(euros);
  const mark = locale.startsWith('el') ? ',' : '.';
  return `${euros}${mark}${String(rest).padStart(2, '0')}`;
}
