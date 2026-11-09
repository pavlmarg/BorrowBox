import type { Routes } from '@angular/router';

/**
 * The caller's bookings (signed in; the guard sits on the parent route).
 * Notification emails link to `/bookings/<id>`, so these paths are fixed.
 */
export const bookingsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./bookings-list.page').then((m) => m.BookingsListPage),
  },
  {
    path: ':id',
    loadComponent: () => import('./booking.page').then((m) => m.BookingPage),
  },
];
