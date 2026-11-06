import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { DataSource } from 'typeorm';
import {
  UserDeletionRequestedV1,
  UserEmailVerifiedV1,
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
import { lockUser, markAccountDeleted } from '../accounts/accounts.repository';
import { markUserDeleted, saveVerified } from './verified-users.repository';

/** Also the consumer name in `processed_events`. */
export const USER_EVENTS_QUEUE = 'payments.user-events';

/** `user.email_verified.v1` and `user.deletion_requested.v1`, checked at runtime. */
class UserIdPayload {
  @IsUUID()
  userId!: string;
}

/**
 * Identity's user events → who may set up payouts (A6), and erasure (A7):
 * the account is closed and its Stripe account queued for deletion, which
 * the worker carries out. The row itself stays (P12).
 */
@Injectable()
export class UserEventsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger('UserEvents');

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  /** The EventBus closes the subscription on shutdown, before the DataSource goes. */
  async onApplicationBootstrap(): Promise<void> {
    await this.bus.subscribe({
      queue: USER_EVENTS_QUEUE,
      routingKeys: [
        UserEmailVerifiedV1.routingKey,
        UserDeletionRequestedV1.routingKey,
      ],
      handler: (envelope, { routingKey }) => this.handle(envelope, routingKey),
    });
  }

  /** Runs each event at most once; a thrown error means retry, then DLQ. */
  async handle(envelope: EventEnvelope, routingKey: string): Promise<void> {
    switch (routingKey) {
      case UserEmailVerifiedV1.routingKey: {
        const { userId } = parsePayload(envelope, UserIdPayload);
        await handleOnce(this.dataSource, USER_EVENTS_QUEUE, envelope, (tx) =>
          saveVerified(tx, userId, envelope.occurredAt),
        );
        return;
      }
      case UserDeletionRequestedV1.routingKey: {
        const { userId } = parsePayload(envelope, UserIdPayload);
        const ran = await handleOnce(
          this.dataSource,
          USER_EVENTS_QUEUE,
          envelope,
          async (tx) => {
            // Waits for an onboarding in flight, then closes the account.
            await lockUser(tx, userId);
            await markUserDeleted(tx, userId);
            await markAccountDeleted(tx, userId);
          },
        );
        if (ran) {
          this.logger.log(`Erased account data (eventId=${envelope.eventId})`);
        }
        return;
      }
      default:
        throw new InvalidEventError(routingKey, ['routingKey']);
    }
  }
}
