import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { Api } from '../../api/api';
import {
  authControllerLogin,
  authControllerLogout,
  authControllerRefresh,
  authControllerRegister,
} from '../../api/functions';
import type {
  AuthResponse,
  LoginBody,
  RegisterBody,
  UserProfileResponse,
} from '../../api/models';
import { AuthChannel } from './auth-channel';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  user: UserProfileResponse | null;
  /** In memory only: never in localStorage, where any injected script could read it. */
  accessToken: string | null;
  /** Epoch ms. */
  accessTokenExpiresAt: number | null;
  status: AuthStatus;
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  accessTokenExpiresAt: null,
  status: 'unknown',
};

/** Refresh this long before expiry so requests don't race the deadline. */
export const REFRESH_MARGIN_MS = 30_000;

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ status }) => ({
    isAuthenticated: computed(() => status() === 'authenticated'),
  })),
  withProps(() => ({
    _api: inject(Api),
    _channel: inject(AuthChannel),
    /** Bookkeeping that isn't UI state. */
    _meta: {
      sessionAt: 0,
      refreshing: null as Promise<boolean> | null,
      initialising: null as Promise<void> | null,
    },
  })),
  withMethods((store) => {
    const setSession = (session: AuthResponse, broadcast: boolean) => {
      store._meta.sessionAt = Date.now();
      patchState(store, {
        user: session.user,
        accessToken: session.accessToken,
        accessTokenExpiresAt: Date.parse(session.accessTokenExpiresAt),
        status: 'authenticated',
      });
      if (broadcast) store._channel.post({ type: 'session', session });
    };

    const clear = (broadcast: boolean) => {
      patchState(store, { ...initialState, status: 'anonymous' });
      if (broadcast) store._channel.post({ type: 'logout' });
    };

    const doRefresh = async (): Promise<boolean> => {
      const requestedAt = Date.now();
      return store._channel.withRefreshLock(async () => {
        // Another tab may have refreshed while we waited for the lock.
        const expiresAt = store.accessTokenExpiresAt();
        if (
          store._meta.sessionAt > requestedAt &&
          expiresAt !== null &&
          expiresAt - Date.now() > REFRESH_MARGIN_MS
        ) {
          return true;
        }
        try {
          setSession(await store._api.invoke(authControllerRefresh), true);
          return true;
        } catch (err) {
          if (err instanceof HttpErrorResponse && err.status === 401) {
            clear(store.status() === 'authenticated');
          } else if (store.status() === 'unknown') {
            patchState(store, { status: 'anonymous' });
          }
          return false;
        }
      });
    };

    /** One refresh at a time per tab (and, via the lock, across tabs). */
    const refresh = (): Promise<boolean> => {
      store._meta.refreshing ??= doRefresh().finally(() => {
        store._meta.refreshing = null;
      });
      return store._meta.refreshing;
    };

    return {
      _setSession: setSession,
      _clear: clear,
      refresh,

      /** Refreshes if the access token is about to expire. */
      async ensureFresh(): Promise<void> {
        const expiresAt = store.accessTokenExpiresAt();
        if (
          store.status() === 'authenticated' &&
          expiresAt !== null &&
          expiresAt - Date.now() < REFRESH_MARGIN_MS
        ) {
          await refresh();
        }
      },

      /** Restores the session from the refresh cookie, once per page load. */
      init(): Promise<void> {
        store._meta.initialising ??= (async () => {
          if (store.status() === 'unknown') await refresh();
        })();
        return store._meta.initialising;
      },

      async login(body: LoginBody): Promise<void> {
        setSession(
          await store._api.invoke(authControllerLogin, { body }),
          true,
        );
      },

      async register(body: RegisterBody): Promise<void> {
        setSession(
          await store._api.invoke(authControllerRegister, { body }),
          true,
        );
      },

      async logout(): Promise<void> {
        try {
          await store._api.invoke(authControllerLogout);
        } finally {
          clear(true);
        }
      },

      /** After the account was deleted server-side. */
      signedOut(): void {
        clear(true);
      },

      updateUser(user: UserProfileResponse): void {
        patchState(store, { user });
      },
    };
  }),
  withHooks({
    onInit(store) {
      store._channel.messages
        .pipe(takeUntilDestroyed())
        .subscribe((message) =>
          message.type === 'session'
            ? store._setSession(message.session, false)
            : store._clear(false),
        );
    },
  }),
);

export type AuthStore = InstanceType<typeof AuthStore>;
