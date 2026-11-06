import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  ItemCreatedV1,
  ItemDeletedV1,
  ItemUpdatedV1,
  type EventEnvelope,
} from '@borrowbox/contracts';
import type { EventBus } from '@borrowbox/messaging';
import { handleOnce } from '@borrowbox/outbox';
import {
  DATA_SOURCE,
  EVENT_BUS,
  InvalidEventError,
  parsePayload,
} from '@borrowbox/service-kit';
import { cancelBookings } from '../bookings/booking-transitions';
import { lockOpenBookings } from '../bookings/bookings.repository';
import { ItemDeletedPayload, parseItemSnapshot } from './event-payloads';
import { markItemDeleted, saveItemSnapshot } from './items.repository';

/** Also the consumer name in `processed_events`. */
export const ITEM_EVENTS_QUEUE = 'bookings.item-events';

/**
 * Catalog's item events → Bookings' item read model. A deleted item's open
 * bookings are cancelled; pausing only stops new requests (ADR-0015).
 */
@Injectable()
export class ItemEventsConsumer implements OnApplicationBootstrap {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.bus.subscribe({
      queue: ITEM_EVENTS_QUEUE,
      routingKeys: [
        ItemCreatedV1.routingKey,
        ItemUpdatedV1.routingKey,
        ItemDeletedV1.routingKey,
      ],
      handler: (envelope, { routingKey }) => this.handle(envelope, routingKey),
    });
  }

  /** Runs each event at most once; a thrown error means retry, then DLQ. */
  async handle(envelope: EventEnvelope, routingKey: string): Promise<void> {
    switch (routingKey) {
      case ItemCreatedV1.routingKey:
      case ItemUpdatedV1.routingKey: {
        const item = parseItemSnapshot(envelope);
        await handleOnce(this.dataSource, ITEM_EVENTS_QUEUE, envelope, (tx) =>
          saveItemSnapshot(tx, item, envelope.occurredAt),
        );
        return;
      }
      case ItemDeletedV1.routingKey: {
        const { itemId, lenderId } = parsePayload(envelope, ItemDeletedPayload);
        await handleOnce(
          this.dataSource,
          ITEM_EVENTS_QUEUE,
          envelope,
          async (tx) => {
            // Waits for requests in flight (they hold the item row).
            await markItemDeleted(tx, itemId, lenderId, envelope.occurredAt);
            const ids = await lockOpenBookings(tx, { itemId });
            await cancelBookings(tx, ids, 'ITEM_DELETED', envelope);
          },
        );
        return;
      }
      default:
        throw new InvalidEventError(routingKey, ['routingKey']);
    }
  }
}
