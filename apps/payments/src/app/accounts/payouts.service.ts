import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { PayoutAccountView, StripeLinkView } from '@borrowbox/contracts';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import type { PaymentsConfig } from '../config';
import { PaymentsError, unauthenticated, viaStripe } from '../payments.error';
import {
  STRIPE_API,
  StripeRequestError,
  type StripeApi,
  type StripeLink,
} from '../stripe/stripe-api';
import { findUser } from '../users/verified-users.repository';
import {
  findAccountByUser,
  flagsOf,
  forgetRefusedAccount,
  insertAccount,
  lockUser,
  setStripeAccountId,
  type AccountRow,
} from './accounts.repository';
import { payoutStatus } from './payout-status';

/** Where Stripe sends the lender back to (A9); the PWA page comes with the web pass. */
const PAYOUTS_PAGE = '/settings/payouts';

/**
 * A lender's payout setup (ADR-0019, PR A): their status, Stripe's hosted
 * onboarding, and their Stripe Express dashboard. Stripe asks the lender
 * for everything it needs; Payments sends Stripe nothing personal (A2).
 */
@Injectable()
export class PayoutsService {
  private readonly country: string;
  private readonly webBaseUrl: string;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(STRIPE_API) private readonly stripe: StripeApi,
    config: ConfigService<PaymentsConfig, true>,
  ) {
    this.country = config.get('STRIPE_ACCOUNT_COUNTRY', { infer: true });
    this.webBaseUrl = config.get('WEB_BASE_URL', { infer: true });
  }

  /** From what Stripe last told Payments; never calls Stripe. */
  async status(userId: string): Promise<PayoutAccountView> {
    const tx = this.dataSource.manager;
    const row = await this.liveAccount(tx, userId);
    return toView(row);
  }

  /**
   * Creates the lender's Stripe account the first time (A1) and returns a
   * link to Stripe's onboarding. Safe to repeat: the row is written first,
   * and Stripe's idempotency key is derived from it, so a retry after a
   * crash gets the same Stripe account back. A refused creation drops the
   * row, so a retry isn't refused again under the same key.
   */
  async startOnboarding(userId: string): Promise<StripeLinkView> {
    const row = await this.dataSource.transaction(async (tx) => {
      // Erasure takes the same lock: it can't slip in between.
      await lockUser(tx, userId);
      const existing = await this.liveAccount(tx, userId);
      const user = await findUser(tx, userId);
      if (!user?.email_verified_at) {
        throw new PaymentsError(
          'EMAIL_NOT_VERIFIED',
          'Verify your email address to set up payouts',
        );
      }
      return existing ?? insertAccount(tx, randomUUID(), userId);
    });

    let accountId = row.stripe_account_id;
    if (!accountId) {
      // Outside the transaction: no lock is held while Stripe answers.
      accountId = await viaStripe(async () => {
        try {
          return await this.stripe.createAccount({
            userId,
            country: this.country,
            idempotencyKey: `account-${row.id}`,
          });
        } catch (err) {
          // Stripe made no account, but answers this key with the same
          // refusal for 24 hours. A new row brings a new key, so the next
          // try works as soon as the cause is fixed.
          if (err instanceof StripeRequestError) {
            await forgetRefusedAccount(this.dataSource.manager, row.id);
          }
          throw err;
        }
      });
      await setStripeAccountId(this.dataSource.manager, row.id, accountId);
    }
    // An erasure that came in while Stripe was answering wins: the worker
    // deletes the Stripe account (the id is saved), and no link goes out.
    const current = await findAccountByUser(this.dataSource.manager, userId);
    if (current?.deleted_at) throw unauthenticated();

    const page = `${this.webBaseUrl}${PAYOUTS_PAGE}`;
    const link = await viaStripe(() =>
      this.stripe.createOnboardingLink({
        accountId,
        returnUrl: `${page}?stripe=return`,
        refreshUrl: `${page}?stripe=refresh`,
      }),
    );
    return toLinkView(link);
  }

  /** Stripe's Express dashboard (payouts, bank account), once onboarding was sent. */
  async dashboardLink(userId: string): Promise<StripeLinkView> {
    const row = await this.liveAccount(this.dataSource.manager, userId);
    if (!row?.stripe_account_id || !row.details_submitted) {
      throw new PaymentsError(
        'PAYOUTS_NOT_SET_UP',
        'Finish setting up payouts first',
      );
    }
    const accountId = row.stripe_account_id;
    return toLinkView(
      await viaStripe(() => this.stripe.createDashboardLink(accountId)),
    );
  }

  /**
   * The caller's account row, or null if they never started. An erased
   * account's still-valid token can't use Payments any more.
   */
  private async liveAccount(
    tx: DataSource['manager'],
    userId: string,
  ): Promise<AccountRow | null> {
    if ((await findUser(tx, userId))?.deleted_at) throw unauthenticated();
    const row = await findAccountByUser(tx, userId);
    if (row?.deleted_at) throw unauthenticated();
    return row;
  }
}

export function toView(row: AccountRow | null): PayoutAccountView {
  return {
    status: payoutStatus(row ? flagsOf(row) : null),
    payoutsEnabled: row?.payouts_enabled ?? false,
    updatedAt: row?.synced_at?.toISOString() ?? null,
  };
}

function toLinkView(link: StripeLink): StripeLinkView {
  return { url: link.url, expiresAt: link.expiresAt?.toISOString() ?? null };
}
