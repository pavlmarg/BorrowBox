import type { NavIconName } from './nav-icon';

export interface NavItem {
  /** Transloco key under `nav.`. */
  readonly key: string;
  readonly icon: NavIconName;
  /** Absent: the feature arrives in a later phase and shows as "Soon". */
  readonly route?: string;
}

/** The sidebar's main section. A later phase enables an item by adding its route. */
export const MAIN_NAV: readonly NavItem[] = [
  { key: 'explore', icon: 'explore' }, // Phase 2
  { key: 'myItems', icon: 'items' }, // Phase 2
  { key: 'rentals', icon: 'rentals' }, // Phase 3
  { key: 'messages', icon: 'messages' }, // Phase 6
  { key: 'profile', icon: 'profile', route: '/profile' },
];

/** Pinned to the bottom of the sidebar. */
export const FOOTER_NAV: readonly NavItem[] = [
  { key: 'settings', icon: 'settings', route: '/settings' },
];
