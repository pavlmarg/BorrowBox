import type { Routes } from '@angular/router';

/**
 * Chat (ADR-0017; signed in, the guard sits on the parent route). The list
 * and the open conversation share one layout, so the list stays put while
 * conversations open beside it.
 */
export const chatRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./messages.layout').then((m) => m.MessagesLayout),
    children: [
      // The layout uses the whole area; each pane scrolls on its own.
      { path: '', data: { fullBleed: true }, children: [] },
      {
        // Notifications' emails link here.
        path: ':id',
        data: { fullBleed: true },
        loadComponent: () => import('./thread.page').then((m) => m.ThreadPage),
      },
    ],
  },
];
