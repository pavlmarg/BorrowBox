import { defineEvent } from '../events/envelope';
import type { ItemCategory } from './categories';
import type { ItemPricing, ItemStatus } from './items';

/**
 * The item as other services may know it. `item.created` and `item.updated`
 * both carry the full snapshot, so a consumer's copy (e.g. Bookings') can't
 * drift after a missed or late event: the newest snapshot wins.
 *
 * Deliberately left out: the location (exact or fuzzed) and the description,
 * which no consumer needs, so less personal data travels on the bus.
 */
export interface ItemSnapshotV1 {
  itemId: string;
  lenderId: string;
  title: string;
  category: ItemCategory;
  pricing: ItemPricing;
  depositCents: number;
  status: ItemStatus;
}

/** A lender created an item (it starts as a `DRAFT`). */
export type ItemCreatedV1Payload = ItemSnapshotV1;
export const ItemCreatedV1 = defineEvent<ItemCreatedV1Payload>()(
  'item.created',
  1,
);

/** Any change to the snapshot's fields, including status (publish, pause, unpause). */
export type ItemUpdatedV1Payload = ItemSnapshotV1;
export const ItemUpdatedV1 = defineEvent<ItemUpdatedV1Payload>()(
  'item.updated',
  1,
);

/**
 * The item was deleted by its lender or because the lender's account was
 * deleted. Catalog keeps a tombstone; consumers may keep what the law or
 * existing bookings require.
 */
export interface ItemDeletedV1Payload {
  itemId: string;
  lenderId: string;
}
export const ItemDeletedV1 = defineEvent<ItemDeletedV1Payload>()(
  'item.deleted',
  1,
);
