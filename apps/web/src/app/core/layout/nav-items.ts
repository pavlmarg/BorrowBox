import type { NavIconName } from './nav-icon';

export interface NavItem {
  /** Transloco key under `nav.`. */
  readonly key: string;
  readonly icon: NavIconName;
  /** Absent: the feature arrives in a later phase and shows as "Soon". */
  readonly route?: string;
  /** Hidden from signed-out visitors (E3). */
  readonly requiresAuth?: boolean;
  /** Desktop: in the avatar's menu instead of the top bar. */
  readonly accountMenu?: boolean;
}

/** The main navigation (drawer and top bar). A later phase enables an item by adding its route. */
export const MAIN_NAV: readonly NavItem[] = [
  { key: 'explore', icon: 'explore', route: '/explore' },
  { key: 'myItems', icon: 'items', route: '/my-items', requiresAuth: true },
  { key: 'rentals', icon: 'rentals' }, // Phase 3
  { key: 'messages', icon: 'messages' }, // Phase 6
  {
    key: 'profile',
    icon: 'profile',
    route: '/profile',
    requiresAuth: true,
    accountMenu: true,
  },
];

/** Pinned to the bottom of the drawer; in the avatar's menu on desktop. */
export const FOOTER_NAV: readonly NavItem[] = [
  { key: 'settings', icon: 'settings', route: '/settings', requiresAuth: true },
];
