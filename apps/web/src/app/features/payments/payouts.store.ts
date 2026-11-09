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
  payoutsControllerDashboard,
  payoutsControllerGet,
  payoutsControllerStartOnboarding,
} from '../../api/functions';
import type { PayoutAccountResponse } from '../../api/models';
import { featureErrorKey } from './payments-errors';

/** Refusals the payouts page explains in its own words. */
export const PAYOUTS_ERROR_CODES = [
  'EMAIL_NOT_VERIFIED',
  'PAYOUTS_NOT_SET_UP',
  'PROVIDER_UNAVAILABLE',
] as const;

/**
 * After Stripe sends the lender back, its webhook reaches Payments a little
 * later: look again after these pauses (ms), stopping once payouts are ready.
 */
export const RETURN_REFRESH_DELAYS_MS = [2_000, 4_000, 8_000, 16_000];

interface PayoutsState {
  account: PayoutAccountResponse | null;
  status: 'loading' | 'ready' | 'error';
  /** A Stripe link being fetched: the button waits, the page shows progress. */
  busy: 'onboarding' | 'dashboard' | null;
  /** Looking again after a return from Stripe. */
  refreshing: boolean;
  /** Translation key of the last failure (load or link). */
  errorKey: string | null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The lender's payout account (ADR-0019): its status, and single-use links
 * to Stripe's onboarding and Express dashboard. The links are never kept:
 * the page sends the browser there at once.
 */
export const PayoutsStore = signalStore(
  withState<PayoutsState>({
    account: null,
    status: 'loading',
    busy: null,
    refreshing: false,
    errorKey: null,
  }),
  withProps(() => ({ _api: inject(Api) })),
  withMethods((store) => {
    const fail = (err: unknown) =>
      featureErrorKey(err, 'payouts', PAYOUTS_ERROR_CODES);

    async function load(quiet = false): Promise<void> {
      if (!quiet) patchState(store, { status: 'loading', errorKey: null });
      try {
        const account = await store._api.invoke(payoutsControllerGet);
        patchState(store, { account, status: 'ready', errorKey: null });
      } catch (err) {
        // A failed background look keeps what is shown.
        if (!quiet || !store.account()) {
          patchState(store, { status: 'error', errorKey: fail(err) });
        }
      }
    }

    async function link(
      kind: 'onboarding' | 'dashboard',
    ): Promise<string | null> {
      patchState(store, { busy: kind, errorKey: null });
      try {
        const { url } = await store._api.invoke(
          kind === 'onboarding'
            ? payoutsControllerStartOnboarding
            : payoutsControllerDashboard,
        );
        // Stays busy: the browser is about to leave for Stripe.
        return url;
      } catch (err) {
        patchState(store, { busy: null, errorKey: fail(err) });
        return null;
      }
    }

    return {
      load,

      /** Re-reads the status a few times while Stripe's webhook catches up. */
      async refreshAfterReturn(
        delays: readonly number[] = RETURN_REFRESH_DELAYS_MS,
      ): Promise<void> {
        patchState(store, { refreshing: true });
        try {
          await load(store.account() !== null);
          for (const ms of delays) {
            if (store.account()?.status === 'READY') break;
            await wait(ms);
            await load(true);
          }
        } finally {
          patchState(store, { refreshing: false });
        }
      },

      /** A fresh onboarding link (creates the Stripe account the first time). */
      onboardingLink: () => link('onboarding'),
      dashboardLink: () => link('dashboard'),
    };
  }),
);

export type PayoutsStore = InstanceType<typeof PayoutsStore>;
