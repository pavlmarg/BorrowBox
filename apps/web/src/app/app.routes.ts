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
  {
    path: 'profile',
    canMatch: [authGuard],
    loadChildren: () =>
      import('./features/profile/profile.routes').then((m) => m.profileRoutes),
  },
  // `explore` becomes the signed-in home page in Phase 2.
  { path: '', pathMatch: 'full', redirectTo: startPage },
  { path: '**', redirectTo: startPage },
];
