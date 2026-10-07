import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  UserDeletionRequestedV1,
  UserProfileUpdatedV1,
  UserRegisteredV1,
  type EventEnvelope,
} from '@borrowbox/contracts';
import type { EventBus } from '@borrowbox/messaging';
import { handleOnce } from '@borrowbox/outbox';
import { DATA_SOURCE } from '../database/database.module';
import { EVENT_BUS } from '../events/events.module';
import { eraseItemsOfLender } from '../items/item-erasure';
import { PhotoQueue } from '../photos/photo-queue';
import { markLenderDeleted, saveLenderName } from './lenders.repository';
import {
  InvalidEventError,
  parsePayload,
  UserDeletionPayload,
  UserNamePayload,
} from './user-event-payloads';

/** Also the consumer name in `processed_events`. */
export const USER_EVENTS_QUEUE = 'catalog.user-events';

/**
 * Identity's user events → Catalog's lender names, and GDPR erasure of a
 * deleted account's items. One queue for all three (RabbitMQ topology:
 * `catalog.user-events` + retries + DLQ, ADR-0001).
 */
@Injectable()
export class UserEventsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger('UserEvents');

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly photoQueue: PhotoQueue,
  ) {}

  /** The EventBus closes the subscription on shutdown, before the DataSource goes. */
  async onApplicationBootstrap(): Promise<void> {
    await this.bus.subscribe({
      queue: USER_EVENTS_QUEUE,
      routingKeys: [
        UserRegisteredV1.routingKey,
        UserProfileUpdatedV1.routingKey,
        UserDeletionRequestedV1.routingKey,
      ],
      handler: (envelope, { routingKey }) => this.handle(envelope, routingKey),
    });
  }

  /** Runs each event at most once; a thrown error means retry, then DLQ. */
  async handle(envelope: EventEnvelope, routingKey: string): Promise<void> {
    switch (routingKey) {
      case UserRegisteredV1.routingKey:
      case UserProfileUpdatedV1.routingKey: {
        const { userId, displayName } = parsePayload(envelope, UserNamePayload);
        await handleOnce(this.dataSource, USER_EVENTS_QUEUE, envelope, (tx) =>
          saveLenderName(tx, userId, displayName, envelope.occurredAt),
        );
        return;
      }
      case UserDeletionRequestedV1.routingKey: {
        const { userId } = parsePayload(envelope, UserDeletionPayload);
        let erased: string[] = [];
        const ran = await handleOnce(
          this.dataSource,
          USER_EVENTS_QUEUE,
          envelope,
          async (tx) => {
            await markLenderDeleted(tx, userId, envelope.occurredAt);
            erased = await eraseItemsOfLender(tx, userId, envelope);
          },
        );
        if (ran) {
          // The photos' files, listed in the same transaction (P5).
          await this.photoQueue.cleanup();
          this.logger.log(
            `Erased account data: ${erased.length} item(s) (eventId=${envelope.eventId})`,
          );
        }
        return;
      }
      default:
        throw new InvalidEventError(routingKey, ['routingKey']);
    }
  }
}
