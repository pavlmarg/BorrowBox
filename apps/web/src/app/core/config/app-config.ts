import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * Settings read at runtime from `/config.json` (gitignored; copy
 * `public/config.example.json`), so one build serves every environment and
 * changing the map key needs no rebuild (ADR-0008).
 */
export interface AppConfig {
  /** MapLibre style URL, key included, e.g. MapTiler's `…/style.json?key=…`. Null: no map. */
  mapStyleUrl: string | null;
  /**
   * Stripe's publishable key for the payment form (ADR-0019). Test mode
   * only: anything but a `pk_test_…` key is ignored. Null: no payments.
   */
  stripePublishableKey: string | null;
}

const NO_CONFIG: AppConfig = { mapStyleUrl: null, stripePublishableKey: null };

/** A test-mode publishable key; the example's placeholder isn't one. */
const STRIPE_TEST_KEY = /^pk_test_[A-Za-z0-9]{16,}$/;

/**
 * Keeps only well-formed values: a broken file means "no map" or "no
 * payments", never a crash.
 */
export function parseAppConfig(raw: unknown): AppConfig {
  const fields =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const value = fields['mapStyleUrl'];
  const key = fields['stripePublishableKey'];
  const stripePublishableKey =
    typeof key === 'string' && STRIPE_TEST_KEY.test(key) ? key : null;
  const mapStyleUrl =
    typeof value === 'string' &&
    /^https:\/\/\S+$/.test(value) &&
    !value.includes('YOUR_MAPTILER_KEY')
      ? value
      : null;
  return { mapStyleUrl, stripePublishableKey };
}

/** Loaded once, on first use (only pages with a map or a payment form need it). */
@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly http = inject(HttpClient);
  private loading?: Promise<AppConfig>;

  load(): Promise<AppConfig> {
    this.loading ??= firstValueFrom(this.http.get<unknown>('/config.json'))
      .then(parseAppConfig)
      .catch(() => NO_CONFIG);
    return this.loading;
  }
}
