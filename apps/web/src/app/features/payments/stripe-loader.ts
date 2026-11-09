import { Injectable, inject } from '@angular/core';
import type { Stripe } from '@stripe/stripe-js';
import { AppConfigService } from '../../core/config/app-config';

/**
 * Stripe.js, loaded only when the payment page needs it: `/pure` adds
 * Stripe's script tag on the first call instead of on import, so no other
 * page talks to Stripe. The publishable key comes from `/config.json` (test
 * mode only, see `parseAppConfig`).
 */
@Injectable({ providedIn: 'root' })
export class StripeLoader {
  private readonly config = inject(AppConfigService);
  private loading?: Promise<Stripe | null>;

  /** Null: no key configured, payments unavailable. Rejects if Stripe.js didn't load. */
  load(): Promise<Stripe | null> {
    this.loading ??= this.loadOnce().catch((err: unknown) => {
      // A failed load (offline, blocked) can be tried again.
      this.loading = undefined;
      throw err;
    });
    return this.loading;
  }

  private async loadOnce(): Promise<Stripe | null> {
    const { stripePublishableKey } = await this.config.load();
    if (!stripePublishableKey) return null;
    const { loadStripe } = await import('@stripe/stripe-js/pure');
    const stripe = await loadStripe(stripePublishableKey);
    if (!stripe) throw new Error('Stripe.js did not load');
    return stripe;
  }
}
