import type { Routes } from '@angular/router';

/** Chat (ADR-0017; signed in, the guard sits on the parent route). */
export const chatRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./conversations.page').then((m) => m.ConversationsPage),
  },
  {
    // Notifications' unread emails link here.
    path: ':id',
    // The thread fills the screen: its messages scroll, the composer stays.
    data: { fullBleed: true },
    loadComponent: () => import('./thread.page').then((m) => m.ThreadPage),
  },
];
