// Test-only (excluded from the app build): an in-memory Stripe behind the
// same `StripeApi` interface (P11). Webhook signatures are checked by the
// real SDK code (no network involved), so tests cover the real check.
import Stripe from 'stripe';
import {
  SdkStripeApi,
  StripeUnavailableError,
  type AccountFlags,
  type StripeApi,
  type StripeLink,
  type VerifiedEvent,
} from '../app/stripe/stripe-api';

export const TEST_WEBHOOK_SECRET = 'whsec_testplatform';
export const TEST_CONNECT_WEBHOOK_SECRET = 'whsec_testconnect';

const NO_FLAGS: AccountFlags = {
  detailsSubmitted: false,
  transfersActive: false,
  payoutsEnabled: false,
  disabled: false,
};

export class FakeStripe implements StripeApi {
  /** Stripe account id → its flags. */
  readonly accounts = new Map<string, AccountFlags>();
  /** What each created account was sent (to check nothing personal goes). */
  readonly created: Array<{ id: string; userId: string; country: string }> = [];
  readonly deleted: string[] = [];
  /** While true, every call fails as if Stripe were unreachable. */
  down = false;
  private readonly byIdempotencyKey = new Map<string, string>();
  private readonly sdk = new SdkStripeApi('sk_test_fake');
  private readonly stripe = new Stripe('sk_test_fake');
  private next = 1;

  /** Plays Stripe changing an account, e.g. after onboarding. */
  setFlags(accountId: string, flags: Partial<AccountFlags>): void {
    const current = this.accounts.get(accountId);
    if (!current) throw new Error(`unknown account ${accountId}`);
    this.accounts.set(accountId, { ...current, ...flags });
  }

  /** A `Stripe-Signature` header for `payload`, signed with `secret`. */
  sign(payload: string, secret: string): string {
    return this.stripe.webhooks.generateTestHeaderString({ payload, secret });
  }

  async createAccount(input: {
    userId: string;
    country: string;
    idempotencyKey: string;
  }): Promise<string> {
    this.check();
    const known = this.byIdempotencyKey.get(input.idempotencyKey);
    if (known) return known;
    const id = `acct_test${this.next++}`;
    this.byIdempotencyKey.set(input.idempotencyKey, id);
    this.accounts.set(id, { ...NO_FLAGS });
    this.created.push({ id, userId: input.userId, country: input.country });
    return id;
  }

  async retrieveAccount(accountId: string): Promise<AccountFlags> {
    this.check();
    const flags = this.accounts.get(accountId);
    if (!flags) throw new Error(`unknown account ${accountId}`);
    return { ...flags };
  }

  async deleteAccount(accountId: string): Promise<void> {
    this.check();
    this.accounts.delete(accountId);
    this.deleted.push(accountId);
  }

  async createOnboardingLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<StripeLink> {
    this.check();
    const query = new URLSearchParams({
      return: input.returnUrl,
      refresh: input.refreshUrl,
    });
    return {
      url: `https://connect.stripe.test/setup/${input.accountId}?${query}`,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    };
  }

  async createDashboardLink(accountId: string): Promise<StripeLink> {
    this.check();
    return {
      url: `https://connect.stripe.test/express/${accountId}`,
      expiresAt: null,
    };
  }

  verifyWebhook(
    payload: string,
    signature: string,
    secret: string,
  ): VerifiedEvent {
    return this.sdk.verifyWebhook(payload, signature, secret);
  }

  private check(): void {
    if (this.down) throw new StripeUnavailableError('test');
  }
}
