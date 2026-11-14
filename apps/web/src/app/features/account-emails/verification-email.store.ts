import { inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { Api } from '../../api/api';
import { meControllerSendVerificationEmail } from '../../api/functions';
import { errorCode, type KnownErrorCode } from '../../core/api-errors';

export type SendStatus = 'idle' | 'sending' | 'sent';

interface VerificationEmailState {
  status: SendStatus;
  error: KnownErrorCode | null;
}

/**
 * "Send verification email" for the signed-in user. Identity answers 202
 * whether or not it sent one (at most one per minute per account), so a
 * success always reads as "sent".
 */
export const VerificationEmailStore = signalStore(
  withState<VerificationEmailState>({ status: 'idle', error: null }),
  withProps(() => ({ _api: inject(Api) })),
  withMethods((store) => ({
    async send(): Promise<void> {
      if (store.status() === 'sending') return;
      patchState(store, { status: 'sending', error: null });
      try {
        await store._api.invoke(meControllerSendVerificationEmail);
        patchState(store, { status: 'sent' });
      } catch (err) {
        patchState(store, { status: 'idle', error: errorCode(err) });
      }
    },
  })),
);
