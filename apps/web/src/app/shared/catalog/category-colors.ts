import type { ItemCategory } from '@borrowbox/contracts';

/**
 * One accent colour per category, for its label and distance chip. Spread
 * around the colour wheel, each dark enough for text on the page background
 * (WCAG AA, 4.5:1). Typed against the category list, so a new category
 * can't be left without one.
 */
export const CATEGORY_COLORS: Record<ItemCategory, string> = {
  party: '#b91c1c',
  tools: '#c2410c',
  'diy-ladders': '#b45309',
  kitchen: '#854d0e',
  camping: '#4d7c0f',
  garden: '#15803d',
  travel: '#0f766e',
  cleaning: '#0e7490',
  sports: '#1d4ed8',
  electronics: '#4338ca',
  'photo-video': '#6d28d9',
  music: '#a21caf',
  kids: '#be185d',
  vehicles: '#334155',
  other: '#57534e',
};

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category as ItemCategory] ?? CATEGORY_COLORS.other;
}
