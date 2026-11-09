import type { Route } from '@angular/router';
import { guestGuard } from '../../core/auth/auth.guards';
import { AuthShell } from './auth-shell';

export const authRoutes: Route[] = [
  {
    path: '',
    component: AuthShell,
    children: [
      {
        path: 'register',
        canMatch: [guestGuard],
        loadComponent: () =>
          import('./register.page').then((m) => m.RegisterPage),
      },
      {
        path: 'login',
        canMatch: [guestGuard],
        loadComponent: () => import('./login.page').then((m) => m.LoginPage),
      },
      {
        path: 'callback',
        loadComponent: () =>
          import('./auth-callback.page').then((m) => m.AuthCallbackPage),
      },
      // Email links (ADR-0016) and the reset request: signed in or out.
      {
        path: 'verify-email',
        loadComponent: () =>
          import('../account-emails/verify-email.page').then(
            (m) => m.VerifyEmailPage,
          ),
      },
      {
        path: 'forgot-password',
        loadComponent: () =>
          import('../account-emails/forgot-password.page').then(
            (m) => m.ForgotPasswordPage,
          ),
      },
      {
        path: 'reset-password',
        loadComponent: () =>
          import('../account-emails/reset-password.page').then(
            (m) => m.ResetPasswordPage,
          ),
      },
      { path: '', pathMatch: 'full', redirectTo: 'register' },
    ],
  },
];
