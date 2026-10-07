import type { EntityManager } from 'typeorm';
import {
  createEnvelope,
  ItemDeletedV1,
  type EventEnvelope,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';

/**
 * Turns every remaining item of `lenderId` into a minimal tombstone (no
 * location, offset or description) and writes one `item.deleted` per item to
 * the outbox, in the caller's transaction.
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
  // TypeORM returns [rows, rowCount] for UPDATE … RETURNING.
  const [rows]: [Array<{ id: string }>, number] = await tx.query(
    `UPDATE items
        SET status = 'DELETED',
            deleted_at = now(),
            updated_at = now(),
            description = '',
            location = NULL,
            location_public = NULL,
            offset_m = NULL,
            offset_bearing = NULL
      WHERE lender_id = $1 AND status <> 'DELETED'
      RETURNING id`,
    [lenderId],
  );
  for (const { id } of rows) {
    await addToOutbox(
      tx,
      createEnvelope(
        ItemDeletedV1,
        { itemId: id, lenderId },
        { causedBy: cause },
      ),
    );
  }
  return rows.map((r) => r.id);
}
