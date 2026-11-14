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
  {
    path: 'password',
    loadComponent: () => import('./password.page').then((m) => m.PasswordPage),
  },
  {
    // Stripe sends lenders back here (ADR-0019): /settings/payouts?stripe=…
    path: 'payouts',
    loadComponent: () =>
      import('../payments/payouts.page').then((m) => m.PayoutsPage),
  },
];
