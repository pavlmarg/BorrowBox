import {
  HttpErrorResponse,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import type { ApiErrorResponse } from '../../api/models';
import { AuthStore } from './auth.store';

/** Auth endpoints use the refresh cookie, never the bearer token. */
const isApiCall = (url: string) =>
  url.startsWith('/api/') && !url.startsWith('/api/auth/');

/**
 * Adds `Authorization: Bearer` to API calls, refreshing first when the token
 * is about to expire. On a 401 `UNAUTHENTICATED` it refreshes once and
 * retries; other 401s (e.g. a wrong password on account deletion) pass through.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiCall(req.url)) return next(req);
  const auth = inject(AuthStore);
  const router = inject(Router);

  const withToken = (r: HttpRequest<unknown>) => {
    const token = auth.accessToken();
    return token
      ? r.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : r;
  };

  return from(auth.ensureFresh()).pipe(
    switchMap(() => next(withToken(req))),
    catchError((err: unknown) => {
      const expired =
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        (err.error as Partial<ApiErrorResponse> | null)?.code ===
          'UNAUTHENTICATED';
      if (!expired) return throwError(() => err);

      return from(auth.refresh()).pipe(
        switchMap((ok) => {
          if (!ok) {
            void router.navigate(['/auth/login'], {
              queryParams: { returnUrl: router.url },
            });
            return throwError(() => err);
          }
          return next(withToken(req));
        }),
      );
    }),
  );
};
