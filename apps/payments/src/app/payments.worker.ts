import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { syncAccount } from './accounts/account-sync';
import { findBooking } from './checkout/bookings.repository';
import { applyIntentState } from './checkout/payment-sync';
import {
  claimDueCancels,
  lockPaymentByIntent,
  retryCancelLater,
  updatePayment,
  type CancelJob,
} from './checkout/payments.repository';
import {
  claimDueDeletions,
  markStripeDeleted,
  retryDeletionLater,
  type DeletionJob,
} from './accounts/accounts.repository';
import {
  STRIPE_API,
  StripeCallError,
  StripeRequestError,
  type PaymentIntentState,
  type StripeApi,
} from './stripe/stripe-api';
import {
  claimDueEvents,
  markProcessed,
  pruneStripeEvents,
  retryEventLater,
  type StripeEventRow,
} from './webhooks/stripe-events.repository';

const POLL_MS = 2_000;
const BATCH = 20;
/** A claimed job is retried after this if its worker dies mid-way. */
const LEASE_MS = 2 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
/**
 * A Stripe event still failing after this many attempts is dropped (and
 * logged): with the backoff below, about a day.
 */
const MAX_EVENT_ATTEMPTS = 30;
/**
 * An erased account with no Stripe id yet waits this long before counting
 * as "nothing at Stripe": an onboarding call that started before the
 * erasure may still be saving the id (it takes under a minute).
 */
const WAIT_FOR_STRIPE_ID_MS = 10 * 60 * 1000;
/** A Stripe account deletion failing this many times is logged as an error. */
const DELETION_ALERT_ATTEMPTS = 10;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
/** Processed events are kept this long to recognise Stripe's resends (it retries for 3 days). */
export const KEEP_STRIPE_EVENTS_DAYS = 30;

/**
 * Payments' background work: processes stored Stripe events (P9, A3),
 * cancels the PaymentIntents of bookings that closed unpaid (ADR-0019) and
 * deletes erased lenders' Stripe accounts (A7). All retry with backoff.
 * Logs carry ids and what identifies an error, never Stripe data.
 */
@Injectable()
export class PaymentsWorker
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger('PaymentsWorker');
  private pollTimer?: NodeJS.Timeout;
  private pruneTimer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(STRIPE_API) private readonly stripe: StripeApi,
  ) {}

  onApplicationBootstrap(): void {
    this.pollTimer = setInterval(() => void this.tick(), POLL_MS);
    this.pollTimer.unref();
    this.pruneTimer = setInterval(() => void this.prune(), PRUNE_EVERY_MS);
    this.pruneTimer.unref();
  }

  /** Does everything due now. One run at a time. */
  async runDue(now = new Date()): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run(now).finally(() => (this.running = undefined));
    return this.running;
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.runDue();
    } catch (err) {
      this.logger.warn(
        `Work loop failed: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
  }

  private async run(now: Date): Promise<void> {
    for (;;) {
      const events = await this.dataSource.transaction((tx) =>
        claimDueEvents(tx, BATCH, LEASE_MS),
      );
      for (const event of events) await this.processEvent(event);
      if (events.length < BATCH || this.stopped) break;
    }
    for (;;) {
      const jobs = await this.dataSource.transaction((tx) =>
        claimDueCancels(tx, BATCH, LEASE_MS),
      );
      for (const job of jobs) await this.cancelAtStripe(job);
      if (jobs.length < BATCH || this.stopped) break;
    }
    for (;;) {
      const jobs = await this.dataSource.transaction((tx) =>
        claimDueDeletions(tx, BATCH, LEASE_MS),
      );
      for (const job of jobs) await this.deleteAtStripe(job, now);
      if (jobs.length < BATCH || this.stopped) break;
    }
  }

  private async processEvent(event: StripeEventRow): Promise<void> {
    const tx = this.dataSource.manager;
    try {
      if (event.type === 'account.updated' && event.account_id) {
        await syncAccount(
          this.dataSource,
          this.stripe,
          event.account_id,
          `stripe:${event.event_id}`,
        );
      } else if (event.type.startsWith('payment_intent.') && event.object_id) {
        const intentId = event.object_id;
        await this.syncPayment(
          intentId,
          () => this.stripe.retrievePaymentIntent(intentId),
          `stripe:${event.event_id}`,
          event.type,
        );
      }
      await markProcessed(tx, event.event_id);
    } catch (err) {
      const reason = describe(err);
      if (event.attempts + 1 >= MAX_EVENT_ATTEMPTS) {
        this.logger.error(
          `Dropping Stripe event ${event.event_id} (${event.type}) after ${event.attempts + 1} attempts: ${reason}`,
        );
        await markProcessed(tx, event.event_id);
        return;
      }
      this.logger.warn(
        `Stripe event ${event.event_id} (${event.type}) failed (attempt ${event.attempts + 1}): ${reason}`,
      );
      await retryEventLater(tx, event.event_id, backoff(event.attempts));
    }
  }

  /**
   * Brings our payment up to date with its PaymentIntent, fetched by
   * `fetch` (Stripe's current state, never a webhook's copy). An unknown
   * PaymentIntent (not ours) is ignored.
   */
  private async syncPayment(
    intentId: string,
    fetch: () => Promise<PaymentIntentState>,
    correlationId: string,
    stripeEventType: string | null,
  ): Promise<void> {
    const known = await this.dataSource.query(
      `SELECT 1 FROM payments WHERE stripe_payment_intent_id = $1`,
      [intentId],
    );
    if (known.length === 0) return;
    const intent = await fetch();
    await this.dataSource.transaction(async (tx) => {
      const payment = await lockPaymentByIntent(tx, intentId);
      if (!payment) return;
      const booking = await findBooking(tx, payment.booking_id);
      await applyIntentState(
        tx,
        payment,
        booking,
        intent,
        { correlationId },
        stripeEventType,
      );
    });
  }

  /**
   * The booking closed unpaid: cancels its PaymentIntent so it can't be
   * paid any more. Stripe refuses when the PaymentIntent moved on (paid,
   * processing): then its current state decides, e.g. a refund is due.
   */
  private async cancelAtStripe(job: CancelJob): Promise<void> {
    const tx = this.dataSource.manager;
    const intentId = job.stripe_payment_intent_id;
    if (!intentId) {
      // Nothing at Stripe yet; a checkout that saves an id later re-queues it.
      await updatePayment(tx, job.id, { cancelPending: false });
      return;
    }
    try {
      await this.syncPayment(
        intentId,
        async () => {
          try {
            return await this.stripe.cancelPaymentIntent(intentId);
          } catch (err) {
            if (err instanceof StripeRequestError) {
              return this.stripe.retrievePaymentIntent(intentId);
            }
            throw err;
          }
        },
        `cancel:${job.booking_id}`,
        null,
      );
    } catch (err) {
      const attempt = job.stripe_cancel_attempts + 1;
      const message = `Cancelling PaymentIntent of booking ${job.booking_id} failed (attempt ${attempt}): ${describe(err)}`;
      if (attempt >= DELETION_ALERT_ATTEMPTS) this.logger.error(message);
      else this.logger.warn(message);
      await retryCancelLater(tx, job.id, backoff(job.stripe_cancel_attempts));
    }
  }

  private async deleteAtStripe(job: DeletionJob, now: Date): Promise<void> {
    const tx = this.dataSource.manager;
    if (!job.stripe_account_id) {
      const age = now.getTime() - new Date(job.deleted_at).getTime();
      if (age < WAIT_FOR_STRIPE_ID_MS) {
        // Waiting, not failing: doesn't count as an attempt.
        await retryDeletionLater(tx, job.id, 60_000, false);
      } else {
        await markStripeDeleted(tx, job.id);
      }
      return;
    }
    try {
      await this.stripe.deleteAccount(job.stripe_account_id);
      await markStripeDeleted(tx, job.id);
      this.logger.log(
        `Deleted Stripe account of erased lender (row ${job.id})`,
      );
    } catch (err) {
      const attempt = job.deletion_attempts + 1;
      const message = `Deleting Stripe account (row ${job.id}) failed (attempt ${attempt}): ${describe(err)}`;
      // Kept trying: the account must go (GDPR), however long it takes.
      // After a while it's more likely a refusal than an outage: someone
      // should look (e.g. the account was deleted another way).
      if (attempt >= DELETION_ALERT_ATTEMPTS) this.logger.error(message);
      else this.logger.warn(message);
      await retryDeletionLater(
        tx,
        job.id,
        backoff(job.deletion_attempts),
        true,
      );
    }
  }

  /** Forgets old processed Stripe events; never throws. */
  async prune(): Promise<void> {
    try {
      const deleted = await pruneStripeEvents(
        this.dataSource.manager,
        KEEP_STRIPE_EVENTS_DAYS,
      );
      if (deleted > 0) this.logger.log(`Pruned ${deleted} Stripe event(s)`);
    } catch (err) {
      this.logger.warn(
        `Prune failed: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
  }

  /** Stops polling and lets a running batch finish before the DataSource closes. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.pruneTimer);
    await this.running?.catch(() => undefined);
  }
}

/**
 * For logs: a Stripe failure's class, code, status and request id; for
 * anything else its class only (messages can echo data).
 */
function describe(err: unknown): string {
  if (err instanceof StripeCallError) return `${err.name} (${err.message})`;
  return err instanceof Error ? err.name : 'unknown';
}

/** 1 min, 2, 4, … up to an hour. */
function backoff(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** attempts);
}
