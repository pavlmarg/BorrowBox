import { inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import type { ChatPush } from '@borrowbox/contracts';
import { Api } from '../../api/api';
import { conversationsControllerList } from '../../api/functions';
import type { ConversationViewResponse } from '../../api/models';
import { errorCode, type KnownErrorCode } from '../../core/api-errors';

interface ConversationsState {
  conversations: ConversationViewResponse[];
  nextCursor: string | null;
  status: 'loading' | 'ready' | 'error';
  error: KnownErrorCode | null;
  loadingMore: boolean;
}

/** Most recent activity first, as the API sorts them. */
function byActivity(
  a: ConversationViewResponse,
  b: ConversationViewResponse,
): number {
  return b.lastMessageAt.localeCompare(a.lastMessageAt);
}

/**
 * The signed-in user's conversations (`/messages`), newest activity first,
 * page by page. Live pushes update a known row in place and move it to the
 * top; a message in a conversation not loaded yet reloads the first page.
 */
export const ConversationsStore = signalStore(
  withState<ConversationsState>({
    conversations: [],
    nextCursor: null,
    status: 'loading',
    error: null,
    loadingMore: false,
  }),
  withProps(() => ({ _api: inject(Api), _meta: { seq: 0 } })),
  withMethods((store) => {
    const load = async (): Promise<void> => {
      const seq = ++store._meta.seq;
      // A reload after a reconnect keeps the list on screen meanwhile.
      if (store.status() !== 'ready') {
        patchState(store, { status: 'loading', error: null });
      }
      try {
        const page = await store._api.invoke(conversationsControllerList, {});
        if (seq !== store._meta.seq) return;
        patchState(store, {
          conversations: page.conversations,
          nextCursor: page.nextCursor,
          status: 'ready',
          error: null,
        });
      } catch (err) {
        if (seq !== store._meta.seq) return;
        if (store.status() !== 'ready') {
          patchState(store, { status: 'error', error: errorCode(err) });
        }
      }
    };

    return {
      load,

      async loadMore(): Promise<void> {
        const cursor = store.nextCursor();
        if (!cursor || store.loadingMore()) return;
        const seq = store._meta.seq;
        patchState(store, { loadingMore: true });
        try {
          const page = await store._api.invoke(conversationsControllerList, {
            cursor,
          });
          if (seq !== store._meta.seq) return;
          const known = new Set(store.conversations().map((c) => c.id));
          patchState(store, {
            conversations: [
              ...store.conversations(),
              ...page.conversations.filter((c) => !known.has(c.id)),
            ],
            nextCursor: page.nextCursor,
          });
        } catch {
          // The button stays: the user can try again.
        } finally {
          patchState(store, { loadingMore: false });
        }
      },

      apply(push: ChatPush): void {
        if (store.status() !== 'ready') return;
        const current = store
          .conversations()
          .find((c) => c.id === push.conversationId);
        if (!current) {
          if (push.type === 'message') void load();
          return;
        }
        let next: ConversationViewResponse = current;
        if (push.type === 'message') {
          const known = current.lastMessage?.id === push.message.id;
          next = {
            ...current,
            lastMessage: push.message,
            lastMessageAt: push.message.sentAt,
            unreadCount:
              push.message.mine || known
                ? current.unreadCount
                : current.unreadCount + 1,
          };
        } else if (push.type === 'read') {
          next = { ...current, otherReadAt: push.readAt };
        } else {
          next = {
            ...current,
            openOffer:
              push.offer.status === 'OPEN'
                ? push.offer
                : current.openOffer?.id === push.offer.id
                  ? null
                  : current.openOffer,
          };
        }
        patchState(store, {
          conversations: store
            .conversations()
            .map((c) => (c.id === next.id ? next : c))
            .sort(byActivity),
        });
      },
    };
  }),
);

export type ConversationsStore = InstanceType<typeof ConversationsStore>;
