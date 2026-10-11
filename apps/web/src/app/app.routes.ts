import type { Route } from '@angular/router';
import { authGuard } from './core/auth/auth.guards';

/** The start page, signed in or not: Explore is public (E2). */
export const startPage = () => '/explore';

export const appRoutes: Route[] = [
  {
    path: 'auth',
    loadChildren: () =>
      import('./features/auth/auth.routes').then((m) => m.authRoutes),
  },
  { path: '', pathMatch: 'full', redirectTo: startPage },
  {
    // The app's pages share the sidebar layout. Explore is public; the
    // others carry the auth guard themselves, so unknown URLs fall through
    // to the start page below.
    path: '',
    loadComponent: () =>
      import('./core/layout/app-shell').then((m) => m.AppShell),
    children: [
      {
        path: 'explore',
        // Full width and height: the map fills the page.
        data: { fullBleed: true },
        loadComponent: () =>
          import('./features/explore/explore.page').then((m) => m.ExplorePage),
      },
      {
        path: 'items/:id',
        loadComponent: () =>
          import('./features/item/item.page').then((m) => m.ItemPage),
      },
      {
        path: 'my-items',
        canMatch: [authGuard],
        loadChildren: () =>
          import('./features/my-items/my-items.routes').then(
            (m) => m.myItemsRoutes,
          ),
      },
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
