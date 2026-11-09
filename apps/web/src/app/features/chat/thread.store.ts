import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import type { ChatPush, SystemMessageCode } from '@borrowbox/contracts';
import { Api } from '../../api/api';
import {
  conversationsControllerBookOffer,
  conversationsControllerGet,
  conversationsControllerMessages,
  conversationsControllerRead,
  conversationsControllerReport,
  conversationsControllerSend,
  conversationsControllerSendOffer,
  conversationsControllerWithdrawOffer,
} from '../../api/functions';
import type {
  ConversationViewResponse,
  MessageViewResponse,
  OfferViewResponse,
  ReportReason,
} from '../../api/models';
import { UnreadStore } from '../../core/chat/unread.store';
import { chatError, type ChatError } from './chat-errors';

/** A message on its way, or one that failed and can be sent again. */
export interface PendingMessage {
  /** Picked here; sending it again can't make a second message. */
  id: string;
  text: string;
  status: 'sending' | 'failed';
  errorKey: string | null;
}

interface ThreadState {
  conversationId: string | null;
  conversation: ConversationViewResponse | null;
  /** Oldest first. */
  messages: MessageViewResponse[];
  /** Older messages to page in. */
  nextCursor: string | null;
  status: 'loading' | 'ready' | 'error';
  error: ChatError | null;
  loadingOlder: boolean;
  pending: PendingMessage[];
  /** Something arrived from the other person since the last "read". */
  unseen: boolean;
}

const initialState: ThreadState = {
  conversationId: null,
  conversation: null,
  messages: [],
  nextCursor: null,
  status: 'loading',
  error: null,
  loadingOlder: false,
  pending: [],
  unseen: false,
};

/** Booking moments after which contact details are no longer masked. */
const UNLOCKING: readonly SystemMessageCode[] = [
  'BOOKING_CONFIRMED',
  'BOOKING_PAID',
];

function byTime(a: MessageViewResponse, b: MessageViewResponse): number {
  return a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id);
}

/** Adds or replaces messages by id, keeping them oldest first. */
export function mergeMessages(
  current: readonly MessageViewResponse[],
  incoming: readonly MessageViewResponse[],
): MessageViewResponse[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(byTime);
}

/** The offer inside each message, and the open one, as it is now. */
function withOffer(
  messages: readonly MessageViewResponse[],
  offer: OfferViewResponse,
): MessageViewResponse[] {
  return messages.map((m) =>
    m.offer?.id === offer.id ? { ...m, offer: { ...m.offer, ...offer } } : m,
  );
}

function openOfferAfter(
  current: OfferViewResponse | null,
  offer: OfferViewResponse,
): OfferViewResponse | null {
  if (offer.status === 'OPEN') return offer;
  return current?.id === offer.id ? null : current;
}

/**
 * One conversation (`/messages/:id`): its messages oldest first, paged
 * backwards; sending with a client-picked id; live pushes; read state;
 * reports; and the lender's price offers (ADR-0018).
 */
export const ThreadStore = signalStore(
  withState<ThreadState>(initialState),
  withComputed(({ conversation, messages }) => ({
    isLender: computed(() => conversation()?.role === 'LENDER'),
    closed: computed(() => conversation()?.closed ?? false),
    /** My newest message, for "seen". */
    myLast: computed(() =>
      messages()
        .filter((m) => m.mine && m.kind === 'TEXT')
        .at(-1),
    ),
  })),
  withProps(() => ({
    _api: inject(Api),
    _unread: inject(UnreadStore),
    _meta: { seq: 0, bookingIds: new Map<string, string>() },
  })),
  withMethods((store) => {
    /** Fetches the conversation and its newest page. */
    const fetch = async (
      conversationId: string,
      mode: 'open' | 'merge' | 'replace',
    ): Promise<void> => {
      const seq = ++store._meta.seq;
      if (mode === 'open') {
        patchState(store, { ...initialState, conversationId });
      }
      try {
        const [conversation, page] = await Promise.all([
          store._api.invoke(conversationsControllerGet, { conversationId }),
          store._api.invoke(conversationsControllerMessages, {
            conversationId,
          }),
        ]);
        if (seq !== store._meta.seq) return;
        const newest = [...page.messages].reverse();
        const ids = new Set(newest.map((m) => m.id));
        // Merging keeps the older pages already shown, unless more arrived
        // meanwhile than a page holds (then there'd be a gap).
        const known = store.messages();
        const merge =
          mode === 'merge' &&
          known.length > 0 &&
          (page.nextCursor === null || known.some((m) => ids.has(m.id)));
        patchState(store, {
          conversation,
          messages: mergeMessages(merge ? known : [], newest),
          nextCursor: merge ? store.nextCursor() : page.nextCursor,
          pending: store.pending().filter((p) => !ids.has(p.id)),
          status: 'ready',
          error: null,
          unseen: conversation.unreadCount > 0,
        });
      } catch (err) {
        if (seq !== store._meta.seq) return;
        // A failed refresh keeps what's shown.
        if (store.status() !== 'ready') {
          patchState(store, { status: 'error', error: chatError(err) });
        }
      }
    };

    const refresh = (mode: 'merge' | 'replace' = 'merge'): Promise<void> => {
      const id = store.conversationId();
      return id ? fetch(id, mode) : Promise.resolve();
    };

    const deliver = async (pending: PendingMessage): Promise<void> => {
      const conversationId = store.conversationId();
      if (!conversationId) return;
      try {
        const message = await store._api.invoke(conversationsControllerSend, {
          conversationId,
          body: { messageId: pending.id, text: pending.text },
        });
        if (store.conversationId() !== conversationId) return;
        patchState(store, {
          messages: mergeMessages(store.messages(), [message]),
          pending: store.pending().filter((p) => p.id !== pending.id),
        });
      } catch (err) {
        if (store.conversationId() !== conversationId) return;
        const error = chatError(err);
        if (error.code === 'CONVERSATION_CLOSED') markClosed();
        patchState(store, {
          pending: store
            .pending()
            .map((p) =>
              p.id === pending.id
                ? { ...p, status: 'failed', errorKey: error.key }
                : p,
            ),
        });
      }
    };

    const markClosed = () => {
      const conversation = store.conversation();
      if (conversation && !conversation.closed) {
        patchState(store, { conversation: { ...conversation, closed: true } });
      }
    };

    const applyOffer = (offer: OfferViewResponse) => {
      const conversation = store.conversation();
      patchState(store, {
        messages: withOffer(store.messages(), offer),
        conversation: conversation && {
          ...conversation,
          openOffer: openOfferAfter(conversation.openOffer, offer),
        },
      });
    };

    /** Runs an offer action; a refused one may mean the offer changed. */
    const offerCall = async <T>(
      call: () => Promise<T>,
    ): Promise<{ value: T } | { error: ChatError }> => {
      try {
        return { value: await call() };
      } catch (err) {
        const error = chatError(err);
        if (error.code === 'CONVERSATION_CLOSED') markClosed();
        void refresh();
        return { error };
      }
    };

    return {
      open: (conversationId: string) => fetch(conversationId, 'open'),
      refresh,

      async loadOlder(): Promise<void> {
        const conversationId = store.conversationId();
        const cursor = store.nextCursor();
        if (!conversationId || !cursor || store.loadingOlder()) return;
        patchState(store, { loadingOlder: true });
        try {
          const page = await store._api.invoke(
            conversationsControllerMessages,
            { conversationId, cursor },
          );
          if (store.conversationId() !== conversationId) return;
          patchState(store, {
            messages: mergeMessages(store.messages(), page.messages),
            nextCursor: page.nextCursor,
          });
        } catch {
          // The "older messages" button stays: the user can try again.
        } finally {
          patchState(store, { loadingOlder: false });
        }
      },

      /** Sends a message; the caller has checked its length. */
      send(text: string): Promise<void> {
        const pending: PendingMessage = {
          id: globalThis.crypto.randomUUID(),
          text,
          status: 'sending',
          errorKey: null,
        };
        patchState(store, { pending: [...store.pending(), pending] });
        return deliver(pending);
      },

      /** The same message again, with the same id. */
      retry(id: string): Promise<void> {
        const pending = store.pending().find((p) => p.id === id);
        if (!pending || pending.status === 'sending') return Promise.resolve();
        const again: PendingMessage = {
          ...pending,
          status: 'sending',
          errorKey: null,
        };
        patchState(store, {
          pending: store.pending().map((p) => (p.id === id ? again : p)),
        });
        return deliver(again);
      },

      discard(id: string): void {
        patchState(store, {
          pending: store.pending().filter((p) => p.id !== id),
        });
      },

      /** Marks everything read up to now (the page calls it while visible). */
      async markRead(): Promise<void> {
        const conversationId = store.conversationId();
        if (!conversationId) return;
        patchState(store, { unseen: false });
        try {
          await store._api.invoke(conversationsControllerRead, {
            conversationId,
          });
          const conversation = store.conversation();
          if (conversation?.id === conversationId) {
            patchState(store, {
              conversation: { ...conversation, unreadCount: 0 },
            });
          }
          store._unread.refresh();
        } catch {
          // Not worth an error: the next visit marks it read.
        }
      },

      apply(push: ChatPush): void {
        if (push.conversationId !== store.conversationId()) return;
        if (store.status() !== 'ready') return;
        switch (push.type) {
          case 'message': {
            const message = push.message as MessageViewResponse;
            patchState(store, {
              messages: mergeMessages(store.messages(), [message]),
              pending: store.pending().filter((p) => p.id !== message.id),
              unseen: store.unseen() || !message.mine,
            });
            if (message.offer) applyOffer(message.offer);
            // Contact details show from now on, earlier messages included.
            if (message.systemCode && UNLOCKING.includes(message.systemCode)) {
              void refresh('replace');
            }
            break;
          }
          case 'read': {
            const conversation = store.conversation();
            if (conversation && push.readerId === conversation.other.userId) {
              patchState(store, {
                conversation: { ...conversation, otherReadAt: push.readAt },
              });
            }
            break;
          }
          case 'offer':
            applyOffer(push.offer as OfferViewResponse);
            break;
        }
      },

      /** Resolves with the error, or null once reported. */
      async report(
        messageId: string,
        reason: ReportReason,
      ): Promise<ChatError | null> {
        try {
          await store._api.invoke(conversationsControllerReport, {
            messageId,
            body: { reason },
          });
          return null;
        } catch (err) {
          return chatError(err);
        }
      },

      /** The lender's offer; resolves with the error, or null once sent. */
      async sendOffer(
        start: string,
        end: string,
        rentCents: number,
      ): Promise<ChatError | null> {
        const conversationId = store.conversationId();
        if (!conversationId) return null;
        const result = await offerCall(() =>
          store._api.invoke(conversationsControllerSendOffer, {
            conversationId,
            body: {
              offerId: globalThis.crypto.randomUUID(),
              start,
              end,
              rentCents,
            },
          }),
        );
        if ('error' in result) return result.error;
        applyOffer(result.value);
        // The offer's message arrives by push too; fetch it in case not.
        void refresh();
        return null;
      },

      async withdrawOffer(offerId: string): Promise<ChatError | null> {
        const result = await offerCall(() =>
          store._api.invoke(conversationsControllerWithdrawOffer, { offerId }),
        );
        if ('error' in result) return result.error;
        applyOffer(result.value);
        void refresh();
        return null;
      },

      /** The renter books the offer; resolves with the booking's id. */
      async bookOffer(
        offerId: string,
      ): Promise<{ bookingId: string } | { error: ChatError }> {
        // One id per offer: a retry after a lost answer can't book twice.
        const bookingId =
          store._meta.bookingIds.get(offerId) ?? globalThis.crypto.randomUUID();
        store._meta.bookingIds.set(offerId, bookingId);
        const result = await offerCall(() =>
          store._api.invoke(conversationsControllerBookOffer, {
            offerId,
            body: { bookingId },
          }),
        );
        return 'error' in result ? result : { bookingId: result.value.id };
      },
    };
  }),
);

export type ThreadStore = InstanceType<typeof ThreadStore>;
