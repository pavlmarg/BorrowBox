import { inject } from '@angular/core';
import { Router, type CanMatchFn } from '@angular/router';
import { AuthStore } from './auth.store';
import { DEFAULT_AFTER_LOGIN } from './return-url';

/** Signed-in users only; others go to login and come back afterwards. */
export const authGuard: CanMatchFn = async (_route, segments) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  // Read before awaiting: the full target URL, query params included.
  const target = router.currentNavigation()?.extractedUrl;
  await auth.init();
  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/auth/login'], {
    queryParams: {
      returnUrl: target
        ? router.serializeUrl(target)
        : `/${segments.map((s) => s.path).join('/')}`,
    },
  });
};

/** Login/register pages make no sense when already signed in. */
export const guestGuard: CanMatchFn = async () => {
  const auth = inject(AuthStore);
  await auth.init();
  return auth.isAuthenticated()
    ? inject(Router).parseUrl(DEFAULT_AFTER_LOGIN)
    : true;
};
