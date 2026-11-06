import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import {
  BookingAcceptedV1,
  BookingCancelledV1,
  BookingConfirmedV1,
  BookingDeclinedV1,
  BookingExpiredV1,
  BookingRequestedV1,
  ConversationUnreadV1,
  OfferSentV1,
  UserDeletionRequestedV1,
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
import { queueEmails } from '../emails/email-jobs.repository';
import {
  onAccepted,
  onCancelled,
  onConfirmed,
  onDeclined,
  onExpired,
  onOfferSent,
  onRequested,
  onUnread,
} from '../emails/plan';
import {
  forgetRecipient,
  saveProfile,
  saveRegistered,
} from '../recipients/recipients.repository';
import {
  BookingPayload,
  CancelledPayload,
  DeclinedPayload,
  ExpiredPayload,
  OfferSentPayload,
  ProfilePayload,
  RegisteredPayload,
  UnreadPayload,
  UserIdPayload,
} from './event-payloads';

/** Also the consumer name in `processed_events`. */
export const EVENTS_QUEUE = 'notifications.events';

/**
 * Every event Notifications reacts to, on one queue: Identity's user events
 * keep the recipients; booking, offer and unread-message events queue
 * emails, in the same transaction as `processed_events` (N3).
 */
@Injectable()
export class EventsConsumer implements OnApplicationBootstrap {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.bus.subscribe({
      queue: EVENTS_QUEUE,
      routingKeys: [
        UserRegisteredV1.routingKey,
        UserProfileUpdatedV1.routingKey,
        UserDeletionRequestedV1.routingKey,
        BookingRequestedV1.routingKey,
        BookingAcceptedV1.routingKey,
        BookingConfirmedV1.routingKey,
        BookingDeclinedV1.routingKey,
        BookingExpiredV1.routingKey,
        BookingCancelledV1.routingKey,
        OfferSentV1.routingKey,
        ConversationUnreadV1.routingKey,
      ],
      handler: (envelope, { routingKey }) => this.handle(envelope, routingKey),
    });
  }

  /** Runs each event at most once; a thrown error means retry, then DLQ. */
  async handle(envelope: EventEnvelope, routingKey: string): Promise<void> {
    const effect = this.effectOf(envelope, routingKey);
    await handleOnce(this.dataSource, EVENTS_QUEUE, envelope, effect);
  }

  /** Parses first, so a malformed event fails before anything is recorded. */
  private effectOf(
    envelope: EventEnvelope,
    routingKey: string,
  ): (tx: EntityManager) => Promise<void> {
    const { occurredAt } = envelope;
    switch (routingKey) {
      case UserRegisteredV1.routingKey: {
        const p = parsePayload(envelope, RegisteredPayload);
        return (tx) => saveRegistered(tx, { ...p, occurredAt });
      }
      case UserProfileUpdatedV1.routingKey: {
        const p = parsePayload(envelope, ProfilePayload);
        return (tx) => saveProfile(tx, { ...p, occurredAt });
      }
      case UserDeletionRequestedV1.routingKey: {
        const { userId } = parsePayload(envelope, UserIdPayload);
        return (tx) => forgetRecipient(tx, userId, occurredAt);
      }
      case BookingRequestedV1.routingKey:
        return queue(onRequested(parsePayload(envelope, BookingPayload)));
      case BookingAcceptedV1.routingKey:
        return queue(onAccepted(parsePayload(envelope, BookingPayload)));
      case BookingConfirmedV1.routingKey:
        return queue(onConfirmed(parsePayload(envelope, BookingPayload)));
      case BookingDeclinedV1.routingKey:
        return queue(onDeclined(parsePayload(envelope, DeclinedPayload)));
      case BookingExpiredV1.routingKey:
        return queue(onExpired(parsePayload(envelope, ExpiredPayload)));
      case BookingCancelledV1.routingKey:
        return queue(onCancelled(parsePayload(envelope, CancelledPayload)));
      case OfferSentV1.routingKey:
        return queue(onOfferSent(parsePayload(envelope, OfferSentPayload)));
      case ConversationUnreadV1.routingKey:
        return queue(onUnread(parsePayload(envelope, UnreadPayload)));
      default:
        throw new InvalidEventError(routingKey, ['routingKey']);
    }
  }
}

function queue(emails: ReturnType<typeof onRequested>) {
  return (tx: EntityManager) => queueEmails(tx, emails);
}
