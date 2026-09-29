import type { Route } from '@angular/router';
import { guestGuard } from '../../core/auth/auth.guards';

export const authRoutes: Route[] = [
  {
    path: 'login',
    canMatch: [guestGuard],
    loadComponent: () => import('./login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canMatch: [guestGuard],
    loadComponent: () => import('./register.page').then((m) => m.RegisterPage),
  },
  {
    path: 'callback',
    loadComponent: () =>
      import('./auth-callback.page').then((m) => m.AuthCallbackPage),
  },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
];
