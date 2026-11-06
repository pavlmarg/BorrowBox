import Stripe from 'stripe';
import {
  STRIPE_HTTP_ATTEMPTS,
  STRIPE_HTTP_TIMEOUT_MS,
} from '@borrowbox/contracts';

export const STRIPE_API = Symbol('STRIPE_API');

/**
 * What Payments stores about a connected account: Stripe's flags only,
 * never the account's people, addresses or bank details (A3).
 */
export interface AccountFlags {
  detailsSubmitted: boolean;
  transfersActive: boolean;
  payoutsEnabled: boolean;
  /** Stripe gave a reason for disabling the account (`requirements.disabled_reason`). */
  disabled: boolean;
}

export interface StripeLink {
  url: string;
  expiresAt: Date | null;
}

/** A webhook event, verified, reduced to what identifies it (A3). */
export interface VerifiedEvent {
  id: string;
  type: string;
  /** The connected account it's about, for Connect events. */
  accountId: string | null;
}

/**
 * The few Stripe operations Payments uses. Business code depends on this,
 * never on the SDK, so tests run against a fake (P11) and Stripe objects
 * never travel further than this file.
 */
export interface StripeApi {
  /** Creates an Express account; the same `idempotencyKey` returns the same account. */
  createAccount(input: {
    userId: string;
    country: string;
    idempotencyKey: string;
  }): Promise<string>;
  retrieveAccount(accountId: string): Promise<AccountFlags>;
  /** Resolves when deleted or already gone. */
  deleteAccount(accountId: string): Promise<void>;
  createOnboardingLink(input: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<StripeLink>;
  createDashboardLink(accountId: string): Promise<StripeLink>;
  /** Throws `InvalidSignatureError` unless Stripe signed `payload` with `secret`. */
  verifyWebhook(
    payload: string,
    signature: string,
    secret: string,
  ): VerifiedEvent;
}

/** Stripe didn't answer, or failed on its side: nothing happened, try again. */
export class StripeUnavailableError extends Error {
  constructor(cause: string) {
    super(`Stripe unavailable: ${cause}`);
    this.name = 'StripeUnavailableError';
  }
}

export class InvalidSignatureError extends Error {
  constructor() {
    super('Invalid webhook signature');
    this.name = 'InvalidSignatureError';
  }
}

/** The SDK behind `StripeApi`: test mode, pinned API version, short timeouts. */
export class SdkStripeApi implements StripeApi {
  private readonly stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, {
      // Pinned: response shapes only change when we upgrade on purpose.
      apiVersion: '2026-10-28.endive',
      timeout: STRIPE_HTTP_TIMEOUT_MS,
      // Retries reuse the request's idempotency key, so they're safe.
      maxNetworkRetries: STRIPE_HTTP_ATTEMPTS - 1,
      typescript: true,
    });
  }

  async createAccount({
    userId,
    country,
    idempotencyKey,
  }: {
    userId: string;
    country: string;
    idempotencyKey: string;
  }): Promise<string> {
    const account = await call(() =>
      this.stripe.accounts.create(
        {
          type: 'express',
          country,
          // Separate charges and transfers (ADR-0003): lenders only
          // receive transfers, under the recipient service agreement.
          capabilities: { transfers: { requested: true } },
          tos_acceptance: { service_agreement: 'recipient' },
          // Our id only (A2): Stripe asks the lender for everything else.
          metadata: { userId },
        },
        { idempotencyKey },
      ),
    );
    return account.id;
  }

  async retrieveAccount(accountId: string): Promise<AccountFlags> {
    const account = await call(() => this.stripe.accounts.retrieve(accountId));
    return {
      detailsSubmitted: account.details_submitted ?? false,
      transfersActive: account.capabilities?.transfers === 'active',
      payoutsEnabled: account.payouts_enabled ?? false,
      disabled: Boolean(account.requirements?.disabled_reason),
    };
  }

  async deleteAccount(accountId: string): Promise<void> {
    try {
      await call(() => this.stripe.accounts.del(accountId));
    } catch (err) {
      if (err instanceof AccountMissingError) return;
      throw err;
    }
  }

  async createOnboardingLink({
    accountId,
    returnUrl,
    refreshUrl,
  }: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<StripeLink> {
    const link = await call(() =>
      this.stripe.accountLinks.create({
        account: accountId,
        type: 'account_onboarding',
        return_url: returnUrl,
        refresh_url: refreshUrl,
      }),
    );
    return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
  }

  async createDashboardLink(accountId: string): Promise<StripeLink> {
    const link = await call(() =>
      this.stripe.accounts.createLoginLink(accountId),
    );
    return { url: link.url, expiresAt: null };
  }

  verifyWebhook(
    payload: string,
    signature: string,
    secret: string,
  ): VerifiedEvent {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, secret);
    } catch {
      throw new InvalidSignatureError();
    }
    return { id: event.id, type: event.type, accountId: event.account ?? null };
  }
}

/** Stripe says the account doesn't exist (e.g. already deleted). */
class AccountMissingError extends Error {}

/**
 * Runs one SDK call. Stripe's error messages can echo request data, so only
 * the error's type travels on, never its message.
 */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      if (
        err instanceof Stripe.errors.StripeInvalidRequestError &&
        err.code === 'resource_missing'
      ) {
        throw new AccountMissingError();
      }
      if (
        err instanceof Stripe.errors.StripeConnectionError ||
        err instanceof Stripe.errors.StripeAPIError ||
        err instanceof Stripe.errors.StripeRateLimitError
      ) {
        throw new StripeUnavailableError(err.type);
      }
    }
    throw err;
  }
}
