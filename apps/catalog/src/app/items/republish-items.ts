import type { DataSource } from 'typeorm';
import { createEnvelope, ItemUpdatedV1 } from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { listLiveItems, toSnapshot } from './items.repository';

/**
 * `nx run catalog:republish-items`: writes the current snapshot of every
 * item not deleted to the outbox as `item.updated`, so a service that
 * started after the items were created (Bookings) can build its read model.
 * RabbitMQ only delivers to queues that exist, so run it once that service
 * is up. Safe to repeat: consumers keep the newest snapshot.
 *
 * The running Catalog's relay publishes the rows.
 */
export async function republishItems(dataSource: DataSource): Promise<string> {
  return dataSource.transaction(async (tx) => {
    const rows = await listLiveItems(tx);
    for (const row of rows) {
      await addToOutbox(tx, createEnvelope(ItemUpdatedV1, toSnapshot(row)));
    }
    return `${rows.length} item snapshot(s) written to the outbox`;
  });
}
