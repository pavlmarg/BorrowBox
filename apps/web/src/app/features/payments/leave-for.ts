import { InjectionToken } from '@angular/core';

/**
 * Sends the browser to another site (Stripe's pages) in this tab. A token,
 * so tests can watch it instead of leaving the test page.
 */
export const LEAVE_FOR = new InjectionToken<(url: string) => void>(
  'LEAVE_FOR',
  { providedIn: 'root', factory: () => (url) => window.location.assign(url) },
);
