import type { EntityManager } from 'typeorm';
import { routingKeyOf, type EventEnvelope } from '@borrowbox/contracts';

/**
 * Records an event in the service's outbox. Must be called with the
 * EntityManager of the transaction that makes the state change, so the change
 * and its event commit (or roll back) together.
 *
 *   await dataSource.transaction(async (tx) => {
 *     await tx.save(booking);
 *     await addToOutbox(tx, createEnvelope(BookingAcceptedV1, payload, { causedBy }));
 *   });
 */
export async function addToOutbox(
  tx: EntityManager,
  envelope: EventEnvelope,
): Promise<void> {
  if (!tx.queryRunner?.isTransactionActive) {
    throw new Error(
      'addToOutbox must run inside the transaction that changes state (use dataSource.transaction)',
    );
  }
  await tx.query(
    `INSERT INTO outbox (event_id, routing_key, envelope) VALUES ($1, $2, $3)`,
    [envelope.eventId, routingKeyOf(envelope), JSON.stringify(envelope)],
  );
}
