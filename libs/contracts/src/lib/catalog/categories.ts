/**
 * Item categories. Fixed slugs, also enforced by a CHECK in Catalog's
 * database; display names live only in the PWA's translations (el + en).
 *
 * Adding a slug is backwards-compatible. Renaming or removing one is a
 * breaking change for stored items and event consumers.
 */
export const ITEM_CATEGORIES = [
  'tools',
  'diy-ladders',
  'garden',
  'cleaning',
  'kitchen',
  'electronics',
  'photo-video',
  'music',
  'sports',
  'camping',
  'travel',
  'kids',
  'party',
  'vehicles',
  'other',
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export function isItemCategory(value: unknown): value is ItemCategory {
  return (ITEM_CATEGORIES as readonly unknown[]).includes(value);
}
