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
  /** The object it's about (`data.object.id`): a PaymentIntent, an account. */
  objectId: string | null;
}

/** A PaymentIntent's status as Stripe names it. */
export const PAYMENT_INTENT_STATUSES = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
  'requires_capture',
  'canceled',
  'succeeded',
] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

/** What Payments needs of a PaymentIntent: never card or personal details. */
export interface PaymentIntentState {
  id: string;
  status: PaymentIntentStatus;
  amountCents: number;
  /** The last attempt failed (declined, failed 3-D Secure). */
  lastAttemptFailed: boolean;
  /** For the renter's browser only: never logged or stored. */
  clientSecret: string;
  /** The charge a successful payment made (transfers are paid from it). */
  latestChargeId: string | null;
}

/** A refund's state, reduced to what Payments acts on. */
export interface RefundState {
  id: string;
  /** PENDING: accepted, on its way to the card; FAILED: it won't arrive. */
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}

/** A connected account as listed by Stripe: only our own carry a user id. */
export interface ListedAccount {
  id: string;
  /** `metadata.userId`, set when Payments created it (A2); null for others. */
  userId: string | null;
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
  /**
   * A card payment of `amountCents` EUR on the platform account for one
   * booking; the same `idempotencyKey` returns the same PaymentIntent.
   */
  createPaymentIntent(input: {
    bookingId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<PaymentIntentState>;
  retrievePaymentIntent(id: string): Promise<PaymentIntentState>;
  /** Cancels a PaymentIntent that hasn't succeeded; returns its state after. */
  cancelPaymentIntent(id: string): Promise<PaymentIntentState>;
  /** Refunds `amountCents` of a payment; the same `idempotencyKey` returns the same refund. */
  createRefund(input: {
    paymentIntentId: string;
    amountCents: number;
    bookingId: string;
    idempotencyKey: string;
  }): Promise<RefundState>;
  retrieveRefund(id: string): Promise<RefundState>;
  /**
   * Transfers `amountCents` to a connected account, paid from the booking's
   * charge (`sourceChargeId`); the same `idempotencyKey` returns the same transfer.
   */
  createTransfer(input: {
    amountCents: number;
    destinationAccountId: string;
    bookingId: string;
    sourceChargeId: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  /** Every connected account of the platform (for the daily reconciliation). */
  listConnectedAccounts(): Promise<ListedAccount[]>;
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
          // receive transfers. Stripe's standard service agreement: the
          // recipient one is only for lenders abroad (ADR-0022).
          capabilities: { transfers: { requested: true } },
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

  async createPaymentIntent({
    bookingId,
    amountCents,
    idempotencyKey,
  }: {
    bookingId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<PaymentIntentState> {
    const intent = await call(() =>
      this.stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'eur',
          // Cards only (Apple Pay / Google Pay come as cards): methods that
          // settle over days would outlive the 24-hour pay-by time.
          allowed_payment_method_types: ['card'],
          // Charged at once (ADR-0003: no authorization holds).
          capture_method: 'automatic',
          // Settlement transfers to the lender by this group (PR C).
          transfer_group: `booking_${bookingId}`,
          // Our id only: no names, emails or receipts (A2).
          metadata: { bookingId },
        },
        { idempotencyKey },
      ),
    );
    return toIntentState(intent);
  }

  async retrievePaymentIntent(id: string): Promise<PaymentIntentState> {
    return toIntentState(
      await call(() => this.stripe.paymentIntents.retrieve(id)),
    );
  }

  async cancelPaymentIntent(id: string): Promise<PaymentIntentState> {
    return toIntentState(
      await call(() => this.stripe.paymentIntents.cancel(id)),
    );
  }

  async createRefund({
    paymentIntentId,
    amountCents,
    bookingId,
    idempotencyKey,
  }: {
    paymentIntentId: string;
    amountCents: number;
    bookingId: string;
    idempotencyKey: string;
  }): Promise<RefundState> {
    const refund = await call(() =>
      this.stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          amount: amountCents,
          metadata: { bookingId },
        },
        { idempotencyKey },
      ),
    );
    return toRefundState(refund);
  }

  async retrieveRefund(id: string): Promise<RefundState> {
    return toRefundState(await call(() => this.stripe.refunds.retrieve(id)));
  }

  async createTransfer({
    amountCents,
    destinationAccountId,
    bookingId,
    sourceChargeId,
    idempotencyKey,
  }: {
    amountCents: number;
    destinationAccountId: string;
    bookingId: string;
    sourceChargeId: string;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    const transfer = await call(() =>
      this.stripe.transfers.create(
        {
          amount: amountCents,
          currency: 'eur',
          destination: destinationAccountId,
          // Settlement by booking (ADR-0003), from the renter's charge, so
          // it doesn't wait for the platform's balance to settle.
          transfer_group: `booking_${bookingId}`,
          source_transaction: sourceChargeId,
          metadata: { bookingId },
        },
        { idempotencyKey },
      ),
    );
    return { id: transfer.id };
  }

  async listConnectedAccounts(): Promise<ListedAccount[]> {
    const accounts = await call(() =>
      this.stripe.accounts.list({ limit: 100 }).autoPagingToArray({
        limit: 10_000,
      }),
    );
    return accounts.map((a) => ({
      id: a.id,
      userId: typeof a.metadata?.userId === 'string' ? a.metadata.userId : null,
    }));
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
    const object = (event as { data?: { object?: { id?: unknown } } }).data
      ?.object;
    return {
      id: event.id,
      type: event.type,
      accountId: event.account ?? null,
      objectId: typeof object?.id === 'string' ? object.id : null,
    };
  }
}

function toIntentState(intent: Stripe.PaymentIntent): PaymentIntentState {
  if (!intent.client_secret) {
    throw new Error('PaymentIntent without a client secret');
  }
  // A status added to Stripe's API later counts as still processing:
  // never as paid, never as failed.
  const status = (PAYMENT_INTENT_STATUSES as readonly string[]).includes(
    intent.status,
  )
    ? (intent.status as PaymentIntentStatus)
    : 'processing';
  return {
    id: intent.id,
    status,
    amountCents: intent.amount,
    lastAttemptFailed: intent.last_payment_error != null,
    clientSecret: intent.client_secret,
    latestChargeId:
      typeof intent.latest_charge === 'string'
        ? intent.latest_charge
        : (intent.latest_charge?.id ?? null),
  };
}

function toRefundState(refund: Stripe.Refund): RefundState {
  return {
    id: refund.id,
    status:
      refund.status === 'succeeded'
        ? 'SUCCEEDED'
        : refund.status === 'failed' || refund.status === 'canceled'
          ? 'FAILED'
          : 'PENDING',
  };
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
    // A request with the same key still running: trying again helps. A key
    // reused with other parameters (400) is a refusal like any other.
    (err instanceof Stripe.errors.StripeIdempotencyError &&
      err.statusCode === 409)
  ) {
    return new StripeUnavailableError(failure);
  }
  return new StripeRequestError(failure);
}
