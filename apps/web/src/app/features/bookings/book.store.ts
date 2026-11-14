import { inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withHooks,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { Api } from '../../api/api';
import {
  bookingsControllerRequest,
  itemBookingsControllerBusy,
  itemBookingsControllerQuote,
} from '../../api/functions';
import type { BookingViewResponse, QuoteResponse } from '../../api/models';
import { bookingErrorCode, type AnyBookingError } from './booking-text';
import { toIntervals, type Interval } from './period-rules';

/** Wait this long after the last change before asking for a quote. */
export const QUOTE_DEBOUNCE_MS = 300;

interface BookState {
  busy: Interval[];
  quote: QuoteResponse | null;
  quoteStatus: 'idle' | 'loading' | 'ready' | 'error';
  quoteError: AnyBookingError | null;
  requesting: boolean;
  requestError: AnyBookingError | null;
}

export interface PeriodChoice {
  readonly start: Date;
  readonly end: Date;
}

/**
 * The booking part of an item page: held periods for the picker, a quote
 * for the chosen period, and the request. One per item page.
 *
 * A request carries an id the browser picks. It stays the same while the
 * period does, so a retry after a lost answer returns the booking already
 * made instead of a second one; a new period gets a new id.
 */
export const BookStore = signalStore(
  withState<BookState>({
    busy: [],
    quote: null,
    quoteStatus: 'idle',
    quoteError: null,
    requesting: false,
    requestError: null,
  }),
  withProps(() => ({
    _api: inject(Api),
    _meta: {
      quoteSeq: 0,
      timer: null as ReturnType<typeof setTimeout> | null,
      attempt: null as { key: string; id: string } | null,
    },
  })),
  withMethods((store) => {
    const clearTimer = () => {
      if (store._meta.timer) clearTimeout(store._meta.timer);
      store._meta.timer = null;
    };

    const fetchQuote = async (itemId: string, period: PeriodChoice) => {
      const seq = ++store._meta.quoteSeq;
      try {
        const quote = await store._api.invoke(itemBookingsControllerQuote, {
          itemId,
          start: period.start.toISOString(),
          end: period.end.toISOString(),
        });
        if (seq !== store._meta.quoteSeq) return;
        patchState(store, { quote, quoteStatus: 'ready', quoteError: null });
      } catch (err) {
        if (seq !== store._meta.quoteSeq) return;
        patchState(store, {
          quote: null,
          quoteStatus: 'error',
          quoteError: bookingErrorCode(err),
        });
      }
    };

    /** The item's held periods; without them the picker still works. */
    const loadBusy = async (itemId: string): Promise<void> => {
      try {
        const res = await store._api.invoke(itemBookingsControllerBusy, {
          itemId,
        });
        patchState(store, { busy: toIntervals(res.periods) });
      } catch {
        // Bookings checks again on request (SLOT_TAKEN).
      }
    };

    return {
      loadBusy,

      /** A new period (or none): asks for its quote after a short pause. */
      choose(itemId: string, period: PeriodChoice | null): void {
        clearTimer();
        store._meta.quoteSeq++;
        patchState(store, { requestError: null });
        if (!period) {
          patchState(store, {
            quote: null,
            quoteStatus: 'idle',
            quoteError: null,
          });
          return;
        }
        patchState(store, { quoteStatus: 'loading', quoteError: null });
        store._meta.timer = setTimeout(() => {
          store._meta.timer = null;
          void fetchQuote(itemId, period);
        }, QUOTE_DEBOUNCE_MS);
      },

      /** Sends the request; the booking on success, else null (see `requestError`). */
      async request(
        itemId: string,
        period: PeriodChoice,
      ): Promise<BookingViewResponse | null> {
        const key = `${itemId}|${period.start.toISOString()}|${period.end.toISOString()}`;
        if (store._meta.attempt?.key !== key) {
          store._meta.attempt = { key, id: crypto.randomUUID() };
        }
        patchState(store, { requesting: true, requestError: null });
        try {
          const booking = await store._api.invoke(bookingsControllerRequest, {
            body: {
              bookingId: store._meta.attempt.id,
              itemId,
              start: period.start.toISOString(),
              end: period.end.toISOString(),
            },
          });
          store._meta.attempt = null;
          return booking;
        } catch (err) {
          const code = bookingErrorCode(err);
          patchState(store, { requestError: code });
          // Someone else took the slot: show it as held.
          if (code === 'SLOT_TAKEN') void loadBusy(itemId);
          return null;
        } finally {
          patchState(store, { requesting: false });
        }
      },

      _clearTimer: clearTimer,
    };
  }),
  withHooks({
    onDestroy(store) {
      store._clearTimer();
    },
  }),
);

export type BookStore = InstanceType<typeof BookStore>;
