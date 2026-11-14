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
  checkoutControllerGet,
  checkoutControllerStart,
} from '../../api/functions';
import type { PaymentStatus, PaymentViewResponse } from '../../api/models';
import { apiCode, featureErrorKey } from './payments-errors';

/** Refusals the payment page explains in its own words. */
export const PAYMENT_ERROR_CODES = [
  'PAYMENT_WINDOW_CLOSED',
  'INVALID_STATE',
  'NOT_FOUND',
  'PROVIDER_UNAVAILABLE',
] as const;

/** Refusals that end paying for good: the page points to the booking. */
const FINAL_CODES: readonly string[] = [
  'PAYMENT_WINDOW_CLOSED',
  'INVALID_STATE',
  'NOT_FOUND',
];

/**
 * After Stripe confirmed the card, its webhook reaches Payments a little
 * later: look again after these pauses (ms, about 30 s in all), then say
 * we'll email.
 */
export const CONFIRM_POLL_DELAYS_MS = [
  1_000, 1_500, 2_000, 3_000, 4_000, 5_000, 6_000, 8_000,
];

/** The money arrived (and maybe moved on since). */
const PAID: ReadonlySet<PaymentStatus> = new Set(['SUCCEEDED', 'SETTLED']);
/** The booking closed: unpaid, or paid and refunded. */
const CLOSED: ReadonlySet<PaymentStatus> = new Set([
  'CANCELLED',
  'NEEDS_REFUND',
  'REFUNDED',
]);

export type CheckoutPhase =
  /** Reading the payment. */
  | 'loading'
  /** Waiting for the card. */
  | 'pay'
  /** Card confirmed at Stripe; waiting for Payments to hear of it. */
  | 'confirming'
  /** Paid: the page moves on to the booking. */
  | 'done'
  /** Still not confirmed after polling: we'll email. */
  | 'slow'
  /** Nothing to pay here any more (already paid, closed, too late, unknown). */
  | 'closed'
  /** Something failed that trying again may fix. */
  | 'error';

interface CheckoutState {
  view: PaymentViewResponse | null;
  phase: CheckoutPhase;
  /** Translation key explaining `closed` or `error`. */
  messageKey: string | null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function phaseFor(status: PaymentStatus): CheckoutPhase {
  if (PAID.has(status)) return 'done';
  if (CLOSED.has(status)) return 'closed';
  if (status === 'PROCESSING') return 'confirming';
  return 'pay';
}

function closedKey(status: PaymentStatus): string | null {
  if (status === 'CANCELLED') return 'payment.closed.cancelled';
  if (status === 'NEEDS_REFUND' || status === 'REFUNDED') {
    return 'payment.closed.refunded';
  }
  return null;
}

/**
 * Paying for one booking (ADR-0019). The client secret for Stripe's form is
 * handed straight to the page and never kept in state.
 */
export const CheckoutStore = signalStore(
  withState<CheckoutState>({ view: null, phase: 'loading', messageKey: null }),
  withProps(() => ({ _api: inject(Api) })),
  withMethods((store) => {
    function failed(err: unknown): void {
      const code = apiCode(err);
      const messageKey = featureErrorKey(err, 'payment', PAYMENT_ERROR_CODES);
      patchState(store, {
        phase: code !== null && FINAL_CODES.includes(code) ? 'closed' : 'error',
        messageKey,
      });
    }

    function show(view: PaymentViewResponse): CheckoutPhase {
      const phase = phaseFor(view.status);
      patchState(store, { view, phase, messageKey: closedKey(view.status) });
      return phase;
    }

    async function read(bookingId: string): Promise<PaymentViewResponse> {
      return store._api.invoke(checkoutControllerGet, { bookingId });
    }

    return {
      /** Where paying stands; never calls Stripe. */
      async load(bookingId: string): Promise<CheckoutPhase> {
        patchState(store, { phase: 'loading', messageKey: null });
        try {
          return show(await read(bookingId));
        } catch (err) {
          failed(err);
          return store.phase();
        }
      },

      /**
       * Starts (or comes back to) paying: the amounts, and the client secret
       * for Stripe's form, or null if paying can't start.
       */
      async start(bookingId: string): Promise<string | null> {
        try {
          const { clientSecret, ...view } = await store._api.invoke(
            checkoutControllerStart,
            { bookingId },
          );
          patchState(store, { view, phase: 'pay', messageKey: null });
          return clientSecret;
        } catch (err) {
          failed(err);
          return null;
        }
      },

      /** Stripe took the payment: wait for Payments to confirm it. */
      async awaitOutcome(
        bookingId: string,
        delays: readonly number[] = CONFIRM_POLL_DELAYS_MS,
      ): Promise<void> {
        patchState(store, { phase: 'confirming', messageKey: null });
        for (let attempt = 0; attempt <= delays.length; attempt++) {
          if (attempt > 0) await wait(delays[attempt - 1]);
          try {
            const view = await read(bookingId);
            patchState(store, { view });
            if (PAID.has(view.status)) {
              patchState(store, { phase: 'done' });
              return;
            }
            if (CLOSED.has(view.status)) {
              // Paid as the booking closed: Payments refunds it.
              patchState(store, {
                phase: 'closed',
                messageKey: 'payment.closed.refunded',
              });
              return;
            }
          } catch {
            // A missed look is fine: the next one may answer.
          }
        }
        patchState(store, { phase: 'slow' });
      },
    };
  }),
);

export type CheckoutStore = InstanceType<typeof CheckoutStore>;
