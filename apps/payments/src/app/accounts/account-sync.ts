import type { DataSource } from 'typeorm';
import {
  createEnvelope,
  PaymentAccountReadyV1,
  PaymentAccountRestrictedV1,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import type { StripeApi } from '../stripe/stripe-api';
import { lockAccountByStripeId, saveFlags } from './accounts.repository';
import { readinessChange } from './payout-status';

/**
 * Brings one connected account up to date (A3, A4): fetches its current
 * flags from Stripe, never trusting the webhook's copy (events can arrive
 * out of order), stores them, and announces a change of readiness through
 * the outbox, in one transaction.
 *
 * Returns false for an account Payments doesn't know (made elsewhere, e.g.
 * in Stripe's dashboard) or one whose owner was erased: nothing to do.
 */
export async function syncAccount(
  dataSource: DataSource,
  stripe: StripeApi,
  stripeAccountId: string,
  correlationId: string,
): Promise<boolean> {
  const flags = await stripe.retrieveAccount(stripeAccountId);
  return dataSource.transaction(async (tx) => {
    const row = await lockAccountByStripeId(tx, stripeAccountId);
    if (!row || row.deleted_at) return false;
    const ready = flags.transfersActive;
    await saveFlags(tx, row.id, flags, ready);
    const change = readinessChange(row.ready, ready);
    if (change) {
      const definition =
        change === 'READY' ? PaymentAccountReadyV1 : PaymentAccountRestrictedV1;
      await addToOutbox(
        tx,
        createEnvelope(definition, { userId: row.user_id }, { correlationId }),
      );
    }
    return true;
  });
}
