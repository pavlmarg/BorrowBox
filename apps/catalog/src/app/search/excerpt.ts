/**
 * The start of `text` in at most `max` characters (code points, like the
 * length limits): whitespace collapsed, cut at the last word that fits and
 * ending in "…" when shortened. A single word longer than that is cut inside.
 */
export function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  // Room for the "…".
  const head = chars.slice(0, max - 1).join('');
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : head;
  return cut.replace(/[\s.,;:!?·–—-]+$/u, '') + '…';
}
