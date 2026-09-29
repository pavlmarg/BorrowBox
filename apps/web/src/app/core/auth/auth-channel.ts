import { DestroyRef, Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import type { AuthResponse } from '../../api/models';

export type AuthMessage =
  { type: 'session'; session: AuthResponse } | { type: 'logout' };

const CHANNEL = 'bb-auth';
const REFRESH_LOCK = 'bb-auth-refresh';

/**
 * Keeps tabs in sync. The refresh cookie is shared by all tabs, and refresh
 * tokens are single-use (reuse revokes the whole session), so:
 * - refreshes are serialised across tabs with a Web Lock, and
 * - a tab that refreshed (or logged out) tells the others over a
 *   BroadcastChannel, so they reuse its access token instead of refreshing.
 */
@Injectable({ providedIn: 'root' })
export class AuthChannel {
  readonly messages = new Subject<AuthMessage>();
  private readonly channel =
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(CHANNEL);

  constructor() {
    this.channel?.addEventListener('message', (event: MessageEvent) =>
      this.messages.next(event.data as AuthMessage),
    );
    inject(DestroyRef).onDestroy(() => this.channel?.close());
  }

  post(message: AuthMessage): void {
    this.channel?.postMessage(message);
  }

  /** Runs `fn` while holding the cross-tab refresh lock (plain call if Web Locks is unavailable). */
  withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks =
      typeof navigator === 'undefined' ? undefined : navigator.locks;
    return locks ? locks.request(REFRESH_LOCK, fn) : fn();
  }
}
