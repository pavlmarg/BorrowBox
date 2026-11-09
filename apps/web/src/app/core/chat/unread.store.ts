import { effect, inject, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  patchState,
  signalStore,
  withHooks,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { Api } from '../../api/api';
import { conversationsControllerUnread } from '../../api/functions';
import { AuthStore } from '../auth/auth.store';
import { ChatSocket } from './chat-socket';

/** Several pushes in a burst cost one request. */
export const UNREAD_REFRESH_DELAY_MS = 300;

/**
 * Unread messages across the signed-in user's conversations, for the
 * Messages badge. Loaded on sign-in and after every (re)connect of the chat
 * socket, and again shortly after each push (a new message, or a thread
 * marked read). Zero when signed out.
 */
export const UnreadStore = signalStore(
  { providedIn: 'root' },
  withState({ total: 0 }),
  withProps(() => ({
    _api: inject(Api),
    _auth: inject(AuthStore),
    _socket: inject(ChatSocket),
    _meta: {
      seq: 0,
      timer: null as ReturnType<typeof setTimeout> | null,
    },
  })),
  withMethods((store) => {
    const load = async (): Promise<void> => {
      const seq = ++store._meta.seq;
      if (!store._auth.isAuthenticated()) {
        patchState(store, { total: 0 });
        return;
      }
      try {
        const { total } = await store._api.invoke(
          conversationsControllerUnread,
        );
        if (seq === store._meta.seq) patchState(store, { total });
      } catch {
        // Keep the last count: the badge is a hint, not worth an error.
      }
    };
    return {
      /** Fetches the count now. */
      load,
      /** Fetches the count soon, once for a burst of changes. */
      refresh(): void {
        if (store._meta.timer !== null) clearTimeout(store._meta.timer);
        store._meta.timer = setTimeout(() => {
          store._meta.timer = null;
          void load();
        }, UNREAD_REFRESH_DELAY_MS);
      },
    };
  }),
  withHooks({
    onInit(store) {
      effect(() => {
        store._auth.isAuthenticated();
        // Signed out, load() just zeroes the count.
        untracked(() => void store.load());
      });
      store._socket.connects
        .pipe(takeUntilDestroyed())
        .subscribe(() => void store.load());
      store._socket.pushes
        .pipe(takeUntilDestroyed())
        .subscribe(() => store.refresh());
    },
    onDestroy(store) {
      if (store._meta.timer !== null) clearTimeout(store._meta.timer);
    },
  }),
);

export type UnreadStore = InstanceType<typeof UnreadStore>;
