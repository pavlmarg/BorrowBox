import type { Route } from '@angular/router';

export const profileRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./profile.page').then((m) => m.ProfilePage),
  },
];

export const settingsRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./settings.page').then((m) => m.SettingsPage),
  },
];
