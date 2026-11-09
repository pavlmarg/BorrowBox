// Test-only (excluded from the app build): an in-memory Stripe behind the
// same `StripeApi` interface (P11). Webhook signatures are checked by the
// real SDK code (no network involved), so tests cover the real check.
import Stripe from 'stripe';
import {
  SdkStripeApi,
  StripeObjectMissingError,
  StripeRequestError,
  StripeUnavailableError,
  type AccountFlags,
  type PaymentIntentState,
  type ListedAccount,
  type PaymentIntentStatus,
  type RefundState,
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
  /** Every account fetched, in order (to check when Stripe is called at all). */
  readonly retrieved: string[] = [];
  /** While true, every call fails as if Stripe were unreachable. */
  down = false;
  /** While true, every call is refused as if the key lacked permission. */
  refusing = false;
  /** Runs while Stripe "creates" an account (to play something happening meanwhile). */
  whileCreating?: () => Promise<void>;
  /** PaymentIntent id → its state, and the booking it was made for. */
  readonly intents = new Map<
    string,
    { state: PaymentIntentState; bookingId: string }
  >();
  /** Runs while Stripe "creates" a PaymentIntent. */
  whileCreatingIntent?: () => Promise<void>;
  /** Refunds made, by id. */
  readonly refunds = new Map<
    string,
    { state: RefundState; paymentIntentId: string; amountCents: number }
  >();
  /** Transfers made, in order. */
  readonly transfers: Array<{
    id: string;
    amountCents: number;
    destinationAccountId: string;
    sourceChargeId: string;
    bookingId: string;
  }> = [];
  /** How new refunds start out (a bank may take days: PENDING). */
  refundStatus: RefundState['status'] = 'SUCCEEDED';
  /** Accounts Stripe has that Payments didn't make through `createAccount` (orphans). */
  readonly extraAccounts: ListedAccount[] = [];
  private readonly byIdempotencyKey = new Map<string, string>();
  /** Account creations Stripe refused, by idempotency key. */
  private readonly refusedKeys = new Map<string, StripeRequestError>();
  private readonly sdk = new SdkStripeApi('sk_test_fake');
  private readonly stripe = new Stripe('sk_test_fake');
  private next = 1;

  /** Plays Stripe changing an account, e.g. after onboarding. */
  setFlags(accountId: string, flags: Partial<AccountFlags>): void {
    const current = this.accounts.get(accountId);
    if (!current) throw new Error(`unknown account ${accountId}`);
    this.accounts.set(accountId, { ...current, ...flags });
  }

  /** The PaymentIntent made for `bookingId`, if any. */
  intentFor(bookingId: string): PaymentIntentState | undefined {
    for (const { state, bookingId: b } of this.intents.values()) {
      if (b === bookingId) return { ...state };
    }
    return undefined;
  }

  /** Plays the renter's bank: the PaymentIntent moves to `status`. */
  setIntent(
    id: string,
    status: PaymentIntentStatus,
    lastAttemptFailed = false,
  ): void {
    const found = this.intents.get(id);
    if (!found) throw new Error(`unknown PaymentIntent ${id}`);
    found.state = {
      ...found.state,
      status,
      lastAttemptFailed,
      latestChargeId:
        status === 'succeeded' ? `ch_for_${id}` : found.state.latestChargeId,
    };
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
    // Like Stripe, a refused key answers with the same refusal (24 hours).
    const refusal = this.refusedKeys.get(input.idempotencyKey);
    if (refusal) throw refusal;
    try {
      this.check();
    } catch (err) {
      if (err instanceof StripeRequestError) {
        this.refusedKeys.set(input.idempotencyKey, err);
      }
      throw err;
    }
    await this.whileCreating?.();
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
    this.retrieved.push(accountId);
    const flags = this.accounts.get(accountId);
    if (!flags) {
      throw new StripeObjectMissingError({
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        statusCode: 404,
        requestId: 'req_test_missing',
      });
    }
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

  async createPaymentIntent(input: {
    bookingId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<PaymentIntentState> {
    this.check();
    await this.whileCreatingIntent?.();
    const known = this.byIdempotencyKey.get(input.idempotencyKey);
    if (known) return this.retrievePaymentIntent(known);
    const id = `pi_test${this.next++}`;
    this.byIdempotencyKey.set(input.idempotencyKey, id);
    this.intents.set(id, {
      bookingId: input.bookingId,
      state: {
        id,
        status: 'requires_payment_method',
        amountCents: input.amountCents,
        lastAttemptFailed: false,
        clientSecret: `${id}_secret_test`,
        latestChargeId: null,
      },
    });
    return this.retrievePaymentIntent(id);
  }

  async retrievePaymentIntent(id: string): Promise<PaymentIntentState> {
    this.check();
    const found = this.intents.get(id);
    if (!found) {
      throw new StripeObjectMissingError({
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        statusCode: 404,
      });
    }
    return { ...found.state };
  }

  async cancelPaymentIntent(id: string): Promise<PaymentIntentState> {
    const state = await this.retrievePaymentIntent(id);
    // Like Stripe: a paid or processing PaymentIntent can't be cancelled.
    if (state.status === 'succeeded' || state.status === 'processing') {
      throw new StripeRequestError({
        type: 'StripeInvalidRequestError',
        code: 'payment_intent_unexpected_state',
        statusCode: 400,
      });
    }
    this.setIntent(id, 'canceled');
    return this.retrievePaymentIntent(id);
  }

  /** Plays the bank: a pending refund arrives (or fails). */
  setRefund(id: string, status: RefundState['status']): void {
    const found = this.refunds.get(id);
    if (!found) throw new Error(`unknown refund ${id}`);
    found.state = { ...found.state, status };
  }

  async createRefund(input: {
    paymentIntentId: string;
    amountCents: number;
    bookingId: string;
    idempotencyKey: string;
  }): Promise<RefundState> {
    this.check();
    const known = this.byIdempotencyKey.get(input.idempotencyKey);
    if (known) return this.retrieveRefund(known);
    const intent = await this.retrievePaymentIntent(input.paymentIntentId);
    const refunded = [...this.refunds.values()]
      .filter((r) => r.paymentIntentId === input.paymentIntentId)
      .reduce((sum, r) => sum + r.amountCents, 0);
    // Like Stripe: never more than what was charged.
    if (
      intent.status !== 'succeeded' ||
      refunded + input.amountCents > intent.amountCents
    ) {
      throw new StripeRequestError({
        type: 'StripeInvalidRequestError',
        code: 'charge_already_refunded',
        statusCode: 400,
      });
    }
    const id = `re_test${this.next++}`;
    this.byIdempotencyKey.set(input.idempotencyKey, id);
    this.refunds.set(id, {
      state: { id, status: this.refundStatus },
      paymentIntentId: input.paymentIntentId,
      amountCents: input.amountCents,
    });
    return this.retrieveRefund(id);
  }

  async retrieveRefund(id: string): Promise<RefundState> {
    this.check();
    const found = this.refunds.get(id);
    if (!found) throw new Error(`unknown refund ${id}`);
    return { ...found.state };
  }

  async createTransfer(input: {
    amountCents: number;
    destinationAccountId: string;
    bookingId: string;
    sourceChargeId: string;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    this.check();
    const known = this.byIdempotencyKey.get(input.idempotencyKey);
    if (known) return { id: known };
    const id = `tr_test${this.next++}`;
    this.byIdempotencyKey.set(input.idempotencyKey, id);
    this.transfers.push({
      id,
      amountCents: input.amountCents,
      destinationAccountId: input.destinationAccountId,
      sourceChargeId: input.sourceChargeId,
      bookingId: input.bookingId,
    });
    return { id };
  }

  async listConnectedAccounts(): Promise<ListedAccount[]> {
    this.check();
    const ours = this.created
      .filter((a) => this.accounts.has(a.id))
      .map((a) => ({ id: a.id, userId: a.userId }));
    return [
      ...ours,
      ...this.extraAccounts.filter((a) => !this.deleted.includes(a.id)),
    ];
  }

  verifyWebhook(
    payload: string,
    signature: string,
    secret: string,
  ): VerifiedEvent {
    return this.sdk.verifyWebhook(payload, signature, secret);
  }

  private check(): void {
    if (this.down) {
      throw new StripeUnavailableError({ type: 'StripeConnectionError' });
    }
    if (this.refusing) {
      throw new StripeRequestError({
        type: 'StripePermissionError',
        statusCode: 403,
        requestId: 'req_test_refused',
      });
    }
  }
}
