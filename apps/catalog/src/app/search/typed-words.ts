/** More words than this add nothing to a suggestion; the rest are ignored. */
export const MAX_TYPED_WORDS = 10;

/**
 * The words of what someone has typed, for prefix matching: lower case,
 * letters and digits only (accents kept; Postgres removes them where it
 * stems). Punctuation and search syntax are separators, so nothing typed can
 * reach `to_tsquery` as syntax.
 */
export function typedWords(text: string): string[] {
  const words = text
    .normalize('NFC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  return (words ?? []).slice(0, MAX_TYPED_WORDS);
}
