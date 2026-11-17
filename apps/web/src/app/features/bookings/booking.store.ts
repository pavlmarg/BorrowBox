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
  bookingsControllerAccept,
  bookingsControllerCancel,
  bookingsControllerDecline,
  bookingsControllerGet,
  bookingsControllerHandoffAnswer,
} from '../../api/functions';
import type { BookingViewResponse, HandoffAnswer } from '../../api/models';
import { bookingErrorCode, type AnyBookingError } from './booking-text';

/** `cancel` is also how a renter withdraws a request. */
export type BookingAction = 'accept' | 'decline' | 'cancel';

type Acting = BookingAction | 'answer';

const ACTIONS = {
  accept: bookingsControllerAccept,
  decline: bookingsControllerDecline,
  cancel: bookingsControllerCancel,
} as const;

interface BookingState {
  booking: BookingViewResponse | null;
  status: 'loading' | 'ready' | 'error';
  error: AnyBookingError | null;
  /** The action running, so its buttons can wait. */
  acting: Acting | null;
}

/**
 * One booking as its renter or lender sees it. Actions answer with the
 * saved booking, which replaces the shown one. A refusal because the
 * booking changed meanwhile (`INVALID_STATE`) reloads it.
 */
export const BookingStore = signalStore(
  withState<BookingState>({
    booking: null,
    status: 'loading',
    error: null,
    acting: null,
  }),
  withProps(() => ({ _api: inject(Api), _meta: { seq: 0 } })),
  withMethods((store) => {
    const load = async (bookingId: string, quiet = false): Promise<void> => {
      const seq = ++store._meta.seq;
      if (!quiet) patchState(store, { status: 'loading', error: null });
      try {
        const booking = await store._api.invoke(bookingsControllerGet, {
          bookingId,
        });
        if (seq !== store._meta.seq) return;
        patchState(store, { booking, status: 'ready', error: null });
      } catch (err) {
        if (seq !== store._meta.seq) return;
        // A quiet refresh that fails keeps what's shown.
        if (!quiet) {
          patchState(store, { status: 'error', error: bookingErrorCode(err) });
        }
      }
    };

    return {
      load,

      /**
       * Answers "did the handoff happen?" (ADR-0026). Final, so the page
       * confirms first; resolves with the error code if it failed.
       */
      async answerHandoff(
        answer: HandoffAnswer,
      ): Promise<AnyBookingError | null> {
        const booking = store.booking();
        const phase = booking?.handoff.question?.phase;
        if (!booking || !phase || store.acting()) return null;
        patchState(store, { acting: 'answer' });
        try {
          const saved = await store._api.invoke(
            bookingsControllerHandoffAnswer,
            { bookingId: booking.id, body: { phase, answer } },
          );
          store._meta.seq++;
          patchState(store, { booking: saved });
          return null;
        } catch (err) {
          const code = bookingErrorCode(err);
          if (code === 'INVALID_STATE') await load(booking.id, true);
          return code;
        } finally {
          patchState(store, { acting: null });
        }
      },

      /** Runs an action; resolves with the error code if it failed. */
      async act(action: BookingAction): Promise<AnyBookingError | null> {
        const booking = store.booking();
        if (!booking || store.acting()) return null;
        patchState(store, { acting: action });
        try {
          const saved = await store._api.invoke(ACTIONS[action], {
            bookingId: booking.id,
          });
          store._meta.seq++;
          patchState(store, { booking: saved });
          return null;
        } catch (err) {
          const code = bookingErrorCode(err);
          if (code === 'INVALID_STATE') await load(booking.id, true);
          return code;
        } finally {
          patchState(store, { acting: null });
        }
      },
    };
  }),
);

export type BookingStore = InstanceType<typeof BookingStore>;
