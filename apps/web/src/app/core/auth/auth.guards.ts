import { inject } from '@angular/core';
import { Router, UrlTree, type CanMatchFn } from '@angular/router';
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
        ? router.serializeUrl(withoutSecrets(target))
        : `/${segments.map((s) => s.path).join('/')}`,
    },
  });
};

/**
 * What Stripe adds when it sends the renter back after 3-D Secure: the
 * client secret must never travel on in a login URL (or its history).
 */
const SECRET_PARAMS = [
  'payment_intent',
  'payment_intent_client_secret',
  'redirect_status',
];

function withoutSecrets(url: UrlTree): UrlTree {
  if (!SECRET_PARAMS.some((p) => p in url.queryParams)) return url;
  const queryParams = { ...url.queryParams };
  for (const p of SECRET_PARAMS) delete queryParams[p];
  return new UrlTree(url.root, queryParams, url.fragment);
}

/** Login/register pages make no sense when already signed in. */
export const guestGuard: CanMatchFn = async () => {
  const auth = inject(AuthStore);
  await auth.init();
  return auth.isAuthenticated()
    ? inject(Router).parseUrl(DEFAULT_AFTER_LOGIN)
    : true;
};
