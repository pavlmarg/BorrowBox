import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import {
  createEnvelope,
  OfferWithdrawnV1,
  type OfferWithdrawReason,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import type { Cause } from '../bookings/booking-transitions';
import type { ChatPushes } from './chat-publisher';
import {
  insertMessage,
  setOfferStatus,
  type OfferRow,
} from './messaging.repository';

/**
 * Ends open offers the caller has locked: `REPLACED` by a newer one, else
 * `WITHDRAWN` (by the lender, or because the item or a person is gone).
 * Writes `offer.withdrawn` and a system line for each, in the caller's
 * transaction (ADR-0018).
 */
export async function withdrawOffers(
  tx: EntityManager,
  offers: OfferRow[],
  reason: OfferWithdrawReason,
  cause: Cause | null,
  pushes: ChatPushes | null,
): Promise<void> {
  for (const offer of offers) {
    await setOfferStatus(
      tx,
      offer.id,
      reason === 'REPLACED' ? 'REPLACED' : 'WITHDRAWN',
    );
    await addToOutbox(
      tx,
      createEnvelope(
        OfferWithdrawnV1,
        {
          offerId: offer.id,
          conversationId: offer.conversation_id,
          itemId: offer.item_id,
          lenderId: offer.lender_id,
          renterId: offer.renter_id,
          reason,
        },
        cause ?? {},
      ),
    );
    // A replaced offer needs no line: the new offer's card follows.
    if (reason !== 'REPLACED') {
      const id = randomUUID();
      await insertMessage(tx, {
        id,
        conversationId: offer.conversation_id,
        kind: 'SYSTEM',
        senderId: null,
        systemCode: 'OFFER_WITHDRAWN',
      });
      pushes?.message(id);
    }
    pushes?.offer(offer.id);
  }
}
