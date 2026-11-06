import type { EntityManager } from 'typeorm';
import type {
  ItemPricing,
  ItemSnapshotV1,
  ItemStatus,
} from '@borrowbox/contracts';

/**
 * The `items` read model: Catalog's item snapshots. The newest snapshot
 * wins, and DELETED is final, so late or repeated events can't undo a
 * deletion.
 */

/** The snapshot fields Bookings keeps (not the category). */
export type ItemSnapshot = Omit<ItemSnapshotV1, 'category'>;

export interface ItemRow {
  item_id: string;
  lender_id: string;
  title: string;
  pricing: ItemPricing;
  deposit_cents: number;
  min_rental_hours: number | null;
  max_rental_hours: number | null;
  status: ItemStatus;
  snapshot_at: Date;
}

/** From `item.created` / `item.updated`; creates the row if missing. */
export async function saveItemSnapshot(
  tx: EntityManager,
  item: ItemSnapshot,
  occurredAt: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO items (item_id, lender_id, title, pricing, deposit_cents,
                        min_rental_hours, max_rental_hours, status, snapshot_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (item_id) DO UPDATE
       SET lender_id = EXCLUDED.lender_id,
           title = EXCLUDED.title,
           pricing = EXCLUDED.pricing,
           deposit_cents = EXCLUDED.deposit_cents,
           min_rental_hours = EXCLUDED.min_rental_hours,
           max_rental_hours = EXCLUDED.max_rental_hours,
           status = EXCLUDED.status,
           snapshot_at = EXCLUDED.snapshot_at
       WHERE items.status <> 'DELETED'
         AND items.snapshot_at < EXCLUDED.snapshot_at`,
    [
      item.itemId,
      item.lenderId,
      item.title,
      JSON.stringify(item.pricing),
      item.depositCents,
      item.minRentalHours,
      item.maxRentalHours,
      item.status,
      occurredAt,
    ],
  );
}

/**
 * From `item.deleted`. An item Bookings never heard of gets a bare
 * tombstone, so a late `item.created` can't make it bookable.
 */
export async function markItemDeleted(
  tx: EntityManager,
  itemId: string,
  lenderId: string,
  occurredAt: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO items (item_id, lender_id, title, pricing, deposit_cents,
                        status, snapshot_at)
     VALUES ($1, $2, '', '{"free": true}', 0, 'DELETED', $3)
     ON CONFLICT (item_id) DO UPDATE SET status = 'DELETED'`,
    [itemId, lenderId, occurredAt],
  );
}

/**
 * The item, or null if unknown. `share` locks the row until the
 * transaction ends, so a deletion waits for a request in flight and then
 * cancels it too.
 */
export async function findItem(
  tx: EntityManager,
  itemId: string,
  options: { share?: boolean } = {},
): Promise<ItemRow | null> {
  const [row] = await tx.query(
    'SELECT * FROM items WHERE item_id = $1' +
      (options.share ? ' FOR SHARE' : ''),
    [itemId],
  );
  return row ?? null;
}
