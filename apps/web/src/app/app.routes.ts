import { inject } from '@angular/core';
import type { Route } from '@angular/router';
import { authGuard } from './core/auth/auth.guards';
import { AuthStore } from './core/auth/auth.store';

/**
 * The start page: signed-in users go to their account, everyone else to
 * register. The app initializer has already restored the session (AuthStore.init).
 */
export const startPage = () =>
  inject(AuthStore).isAuthenticated() ? '/profile' : '/auth/register';

export const appRoutes: Route[] = [
  {
    path: 'auth',
    loadChildren: () =>
      import('./features/auth/auth.routes').then((m) => m.authRoutes),
  },
  // `explore` becomes the signed-in home page in Phase 2.
  { path: '', pathMatch: 'full', redirectTo: startPage },
  {
    // Signed-in pages share the sidebar layout. The guard sits on each
    // child, so unknown URLs fall through to the start page below.
    path: '',
    loadComponent: () =>
      import('./core/layout/app-shell').then((m) => m.AppShell),
    children: [
      {
        path: 'profile',
        canMatch: [authGuard],
        loadChildren: () =>
          import('./features/profile/profile.routes').then(
            (m) => m.profileRoutes,
          ),
      },
      {
        path: 'settings',
        canMatch: [authGuard],
        loadChildren: () =>
          import('./features/profile/profile.routes').then(
            (m) => m.settingsRoutes,
          ),
      },
    ],
  },
  { path: '**', redirectTo: startPage },
];
