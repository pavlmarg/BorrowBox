import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DISTANCE_BANDS,
  ITEM_CATEGORIES,
  PRICE_UNITS,
} from '@borrowbox/contracts';
import { KNOWN_ERROR_CODES } from '../api-errors';
import { LANGUAGES } from './language';

type Tree = { [key: string]: string | Tree };

function load(lang: string): Tree {
  return JSON.parse(
    readFileSync(
      join(__dirname, '../../../../public/i18n', `${lang}.json`),
      'utf8',
    ),
  );
}

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

describe('translations', () => {
  const [el, ...others] = LANGUAGES.map((lang) => ({ lang, tree: load(lang) }));

  it.each(others)('$lang has exactly the same keys as el', ({ tree }) => {
    expect(keys(tree).sort()).toEqual(keys(el.tree).sort());
  });

  it.each(LANGUAGES)('%s has a message for every API error code', (lang) => {
    const all = new Set(keys(load(lang)));
    for (const code of KNOWN_ERROR_CODES) {
      expect(all).toContain(`errors.${code}`);
    }
  });

  it.each(LANGUAGES)(
    '%s has a label for every category, distance band and price unit',
    (lang) => {
      const all = new Set(keys(load(lang)));
      const expected = [
        ...ITEM_CATEGORIES.map((c) => `catalog.categories.${c}`),
        ...DISTANCE_BANDS.map((b) => `catalog.distance.${b}`),
        ...PRICE_UNITS.flatMap((u) => [
          `catalog.units.${u}`,
          `catalog.perUnit.${u}`,
        ]),
      ];
      for (const key of expected) expect(all).toContain(key);
    },
  );

  it.each(LANGUAGES)('%s has no empty strings', (lang) => {
    const tree = load(lang);
    const values = keys(tree).map((k) =>
      k
        .split('.')
        .reduce<string | Tree>((node, part) => (node as Tree)[part], tree),
    );
    expect(
      values.filter((v) => typeof v !== 'string' || v.trim() === ''),
    ).toEqual([]);
  });
});
