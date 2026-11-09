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

/**
 * What may be logged about a failed Stripe call. Never Stripe's message:
 * it can echo request data.
 */
export interface StripeFailure {
  /** The SDK's error class, e.g. `StripeConnectionError`. */
  type: string;
  /** Stripe's error code, e.g. `resource_missing`. */
  code?: string;
  statusCode?: number;
  /** Stripe's request id (`req_…`), to look the call up in its dashboard. */
  requestId?: string;
}

/** A failed Stripe call. Its message holds only the `StripeFailure` fields. */
export abstract class StripeCallError extends Error {
  protected constructor(
    name: string,
    readonly failure: StripeFailure,
  ) {
    super(describeFailure(failure));
    this.name = name;
  }
}

/**
 * Stripe didn't answer, failed on its side, limited the rate, or is still
 * busy with the same idempotent request: nothing changed, try again.
 */
export class StripeUnavailableError extends StripeCallError {
  constructor(failure: StripeFailure) {
    super('StripeUnavailableError', failure);
  }
}

/**
 * Stripe refused the request (authentication, permission, invalid
 * request): a bug or a configuration problem that retrying won't fix.
 */
export class StripeRequestError extends StripeCallError {
  constructor(failure: StripeFailure) {
    super('StripeRequestError', failure);
  }
}

/** Stripe has no such object (`resource_missing`), e.g. an account already deleted. */
export class StripeObjectMissingError extends StripeCallError {
  constructor(failure: StripeFailure) {
    super('StripeObjectMissingError', failure);
  }
}

function describeFailure(f: StripeFailure): string {
  return [
    f.type,
    f.code && `code=${f.code}`,
    f.statusCode && `status=${f.statusCode}`,
    f.requestId && `request=${f.requestId}`,
  ]
    .filter(Boolean)
    .join(' ');
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
      // Only Stripe's own "no such account" counts as gone (decided with
      // the user, 2026-11-08); e.g. a permission error could be a bad key.
      if (err instanceof StripeObjectMissingError) return;
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

/** Runs one SDK call; a Stripe error leaves as a `StripeCallError`. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toStripeCallError(err);
  }
}

/**
 * Wraps an SDK error in one of ours, keeping only what may be logged.
 * Anything else (not from Stripe) is returned as it is.
 */
export function toStripeCallError(err: unknown): unknown {
  if (!(err instanceof Stripe.errors.StripeError)) return err;
  const failure: StripeFailure = {
    type: err.type,
    ...(err.code ? { code: err.code } : {}),
    ...(err.statusCode ? { statusCode: err.statusCode } : {}),
    ...(err.requestId ? { requestId: err.requestId } : {}),
  };
  if (
    err instanceof Stripe.errors.StripeInvalidRequestError &&
    err.code === 'resource_missing'
  ) {
    return new StripeObjectMissingError(failure);
  }
  if (
    err instanceof Stripe.errors.StripeConnectionError ||
    err instanceof Stripe.errors.StripeAPIError ||
    err instanceof Stripe.errors.StripeRateLimitError ||
    err instanceof Stripe.errors.StripeIdempotencyError
  ) {
    return new StripeUnavailableError(failure);
  }
  return new StripeRequestError(failure);
}
