import { typedWords } from './typed-words';

/**
 * Greek accented letters and final sigma, and what they match. Name search
 * (ADR-0025) folds both the typed words and the stored names with this map
 * (the names in SQL, with `translate`), so "μαρια" finds "Μαρία" and
 * "νικος" finds "Νίκος". Other accents are kept on both sides.
 */
export const GREEK_FOLD_FROM = 'άέήίόύώϊϋΐΰς';
export const GREEK_FOLD_TO = 'αεηιουωιυιυσ';

function greekFold(word: string): string {
  let out = '';
  for (const ch of word) {
    const i = GREEK_FOLD_FROM.indexOf(ch);
    out += i < 0 ? ch : GREEK_FOLD_TO[i];
  }
  return out;
}

/** The typed words for name search: lower case, letters and digits, Greek folded. */
export function nameWords(text: string): string[] {
  return typedWords(text).map(greekFold);
}
