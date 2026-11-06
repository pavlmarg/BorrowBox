import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  UserDeletionRequestedV1,
  UserEmailVerifiedV1,
  UserProfileUpdatedV1,
  UserRegisteredV1,
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
import { ChatPublisher, ChatPushes } from '../messaging/chat-publisher';
import {
  eraseMessagesOf,
  lockOpenOffers,
} from '../messaging/messaging.repository';
import { withdrawOffers } from '../messaging/offer-withdrawals';
import { UserIdPayload, UserNamePayload } from './event-payloads';
import {
  lockUserBookings,
  markUserDeleted,
  saveUserName,
  saveUserVerified,
} from './users.repository';

/** Also the consumer name in `processed_events`. */
export const USER_EVENTS_QUEUE = 'bookings.user-events';

/**
 * Identity's user events → Bookings' names and verified emails, and GDPR
 * erasure: a deleted account's open bookings are cancelled and open offers
 * withdrawn, on both sides, and the text of its messages removed. Finished
 * bookings and conversations stay, without the name (ADR-0015, ADR-0017).
 */
@Injectable()
export class UserEventsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger('UserEvents');

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly chat: ChatPublisher,
  ) {}

  /** The EventBus closes the subscription on shutdown, before the DataSource goes. */
  async onApplicationBootstrap(): Promise<void> {
    await this.bus.subscribe({
      queue: USER_EVENTS_QUEUE,
      routingKeys: [
        UserRegisteredV1.routingKey,
        UserProfileUpdatedV1.routingKey,
        UserEmailVerifiedV1.routingKey,
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
          saveUserName(tx, userId, displayName, envelope.occurredAt),
        );
        return;
      }
      case UserEmailVerifiedV1.routingKey: {
        const { userId } = parsePayload(envelope, UserIdPayload);
        await handleOnce(this.dataSource, USER_EVENTS_QUEUE, envelope, (tx) =>
          saveUserVerified(tx, userId, envelope.occurredAt),
        );
        return;
      }
      case UserDeletionRequestedV1.routingKey: {
        const { userId } = parsePayload(envelope, UserIdPayload);
        let cancelled = 0;
        const pushes = new ChatPushes();
        const ran = await handleOnce(
          this.dataSource,
          USER_EVENTS_QUEUE,
          envelope,
          async (tx) => {
            // Waits for the user's requests in flight, then stops new ones.
            await lockUserBookings(tx, userId);
            await markUserDeleted(tx, userId);
            const ids = await lockOpenBookings(tx, { userId });
            await cancelBookings(tx, ids, 'ACCOUNT_DELETED', envelope, pushes);
            cancelled = ids.length;
            await withdrawOffers(
              tx,
              await lockOpenOffers(tx, { userId }),
              'ACCOUNT_DELETED',
              { causedBy: envelope },
              pushes,
            );
            await eraseMessagesOf(tx, userId);
          },
        );
        if (ran) {
          await this.chat.flush(pushes);
          this.logger.log(
            `Erased account data: ${cancelled} booking(s) cancelled (eventId=${envelope.eventId})`,
          );
        }
        return;
      }
      default:
        throw new InvalidEventError(routingKey, ['routingKey']);
    }
  }
}
