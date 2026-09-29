import type { Route } from '@angular/router';
import { authGuard } from './core/auth/auth.guards';

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
  // Phase 1 has no public pages yet; `explore` becomes the home page in Phase 2.
  { path: '', pathMatch: 'full', redirectTo: 'profile' },
  { path: '**', redirectTo: 'profile' },
];
