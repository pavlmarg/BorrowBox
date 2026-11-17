/** Greek style: dots group thousands, a comma marks the cents ("1.000,50"). */
const GROUPED = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/;
/** Plain: "30", "30,5", "30,50" or "30.50". */
const PLAIN = /^\d{1,7}([.,]\d{1,2})?$/;

/**
 * Typed euros as integer cents, or null if it isn't an amount. Integer
 * arithmetic only: no floats ever hold money. Range checks (€1 to the
 * deposit) are the caller's.
 */
export function parseEuroCents(input: string): number | null {
  const text = input.replace(/\s/g, '');
  let normal: string;
  if (GROUPED.test(text)) normal = text.replace(/\./g, '').replace(',', '.');
  else if (PLAIN.test(text)) normal = text.replace(',', '.');
  else return null;
  const [euros, cents = ''] = normal.split('.');
  return Number(euros) * 100 + Number(cents.padEnd(2, '0'));
}
