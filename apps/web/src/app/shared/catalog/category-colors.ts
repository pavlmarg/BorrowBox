import type { ItemCategory } from '@borrowbox/contracts';

/**
 * One accent colour per category, for its label and distance chip: a CSS
 * variable (`--bb-cat-<category>` in styles.scss), so dark mode can give
 * each a lighter shade. Spread around the colour wheel, each with AA
 * contrast (4.5:1) for text on the page background in both themes. Typed
 * against the category list, so a new category can't be left without one.
 */
export const CATEGORY_COLORS: Record<ItemCategory, string> = {
  party: 'var(--bb-cat-party)',
  tools: 'var(--bb-cat-tools)',
  'diy-ladders': 'var(--bb-cat-diy-ladders)',
  kitchen: 'var(--bb-cat-kitchen)',
  camping: 'var(--bb-cat-camping)',
  garden: 'var(--bb-cat-garden)',
  travel: 'var(--bb-cat-travel)',
  cleaning: 'var(--bb-cat-cleaning)',
  sports: 'var(--bb-cat-sports)',
  electronics: 'var(--bb-cat-electronics)',
  'photo-video': 'var(--bb-cat-photo-video)',
  music: 'var(--bb-cat-music)',
  kids: 'var(--bb-cat-kids)',
  vehicles: 'var(--bb-cat-vehicles)',
  other: 'var(--bb-cat-other)',
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category as ItemCategory] ?? CATEGORY_COLORS.other;
}
