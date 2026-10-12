import { inject } from '@angular/core';
import type { CanDeactivateFn, Routes } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';

/** A page that may hold work the user hasn't saved yet. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/** Asks before leaving a page with unsaved changes. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (page) =>
  !page.hasUnsavedChanges() ||
  confirm(inject(TranslocoService).translate('listing.leaveUnsaved'));

/** The lender's own items (signed in; the guard sits on the parent route). */
export const myItemsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./my-items.page').then((m) => m.MyItemsPage),
  },
  {
    path: 'new',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('../listing/listing-wizard.page').then((m) => m.ListingWizardPage),
  },
  {
    path: ':id/edit',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('../listing/listing-wizard.page').then((m) => m.ListingWizardPage),
  },
];
