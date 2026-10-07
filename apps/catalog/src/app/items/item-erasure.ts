import type { EntityManager } from 'typeorm';
import {
  createEnvelope,
  ItemDeletedV1,
  type EventEnvelope,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { lockLenderItems } from '../lenders/lenders.repository';
import { tombstoneItems } from './items.repository';

/**
 * Turns every remaining item of `lenderId` into a minimal tombstone and
 * writes one `item.deleted` per item to the outbox, in the caller's
 * transaction. Takes the lender's item lock first, so an item created with a
 * still-valid token can't slip past the erasure.
 *
 * Photos are not touched yet: their files must be deleted from storage
 * first, which arrives with the photo pipeline (step 10).
 *
 * @returns the ids of the items deleted now
 */
export async function eraseItemsOfLender(
  tx: EntityManager,
  lenderId: string,
  cause: EventEnvelope,
): Promise<string[]> {
  await lockLenderItems(tx, lenderId);
  const ids = await tombstoneItems(tx, lenderId, null);
  for (const itemId of ids) {
    await addToOutbox(
      tx,
      createEnvelope(ItemDeletedV1, { itemId, lenderId }, { causedBy: cause }),
    );
  }
  return ids;
}
