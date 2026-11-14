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
        // Public, like item pages (ADR-0025).
        path: 'users/:id',
        loadComponent: () =>
          import('./features/people/person.page').then((m) => m.PersonPage),
      },
      {
        path: 'my-items',
        canMatch: [authGuard],
        loadChildren: () =>
          import('./features/my-items/my-items.routes').then(
            (m) => m.myItemsRoutes,
          ),
      },
      // Paying for a booking (Phase 4): before `bookings`, which would
      // otherwise match first.
      {
        path: 'bookings/:id/pay',
        canMatch: [authGuard],
        loadComponent: () =>
          import('./features/payments/pay.page').then((m) => m.PayPage),
      },
      {
        path: 'bookings',
        canMatch: [authGuard],
        loadChildren: () =>
          import('./features/bookings/bookings.routes').then(
            (m) => m.bookingsRoutes,
          ),
      },
      {
        path: 'messages',
        canMatch: [authGuard],
        loadChildren: () =>
          import('./features/chat/chat.routes').then((m) => m.chatRoutes),
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
