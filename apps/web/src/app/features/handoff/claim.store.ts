import { inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { Api } from '../../api/api';
import {
  bookingsControllerAnswerClaim,
  bookingsControllerClaim,
  bookingsControllerFileClaim,
  bookingsControllerWithdrawClaim,
} from '../../api/functions';
import type {
  AnswerClaimBody,
  ClaimResponse,
  FileClaimBody,
} from '../../api/models';
import {
  bookingErrorCode,
  type AnyBookingError,
} from '../bookings/booking-text';

export type ClaimAction = 'file' | 'answer' | 'withdraw';

interface ClaimState {
  claim: ClaimResponse | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** The action running, so its buttons can wait. */
  acting: ClaimAction | null;
}

/**
 * A booking's damage claim (ADR-0028). Every action also moves the booking
 * (to DISPUTED, or on to COMPLETED), so callers reload it afterwards.
 */
export const ClaimStore = signalStore(
  withState<ClaimState>({ claim: null, status: 'idle', acting: null }),
  withProps(() => ({ _api: inject(Api), _meta: { seq: 0 } })),
  withMethods((store) => {
    const load = async (bookingId: string, quiet = false): Promise<void> => {
      const seq = ++store._meta.seq;
      if (!quiet) patchState(store, { status: 'loading' });
      try {
        const { claim } = await store._api.invoke(bookingsControllerClaim, {
          bookingId,
        });
        if (seq !== store._meta.seq) return;
        patchState(store, { claim, status: 'ready' });
      } catch {
        if (seq !== store._meta.seq) return;
        if (!quiet) patchState(store, { status: 'error' });
      }
    };

    /** Runs one action; resolves with the error code if it failed. */
    const run = async (
      action: ClaimAction,
      bookingId: string,
      call: () => Promise<ClaimResponse>,
    ): Promise<AnyBookingError | null> => {
      if (store.acting()) return null;
      patchState(store, { acting: action });
      try {
        const claim = await call();
        store._meta.seq++;
        patchState(store, { claim, status: 'ready' });
        return null;
      } catch (err) {
        const code = bookingErrorCode(err);
        if (code === 'INVALID_STATE' || code === 'CLAIM_EXISTS') {
          await load(bookingId, true);
        }
        return code;
      } finally {
        patchState(store, { acting: null });
      }
    };

    return {
      load,

      file: (bookingId: string, body: FileClaimBody) =>
        run('file', bookingId, () =>
          store._api.invoke(bookingsControllerFileClaim, { bookingId, body }),
        ),

      answer: (bookingId: string, body: AnswerClaimBody) =>
        run('answer', bookingId, () =>
          store._api.invoke(bookingsControllerAnswerClaim, { bookingId, body }),
        ),

      withdraw: (bookingId: string) =>
        run('withdraw', bookingId, () =>
          store._api.invoke(bookingsControllerWithdrawClaim, { bookingId }),
        ),
    };
  }),
);

export type ClaimStore = InstanceType<typeof ClaimStore>;
