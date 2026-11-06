import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { DataSource } from 'typeorm';
import {
  BookingAcceptedV1,
  BookingConfirmedV1,
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
import { pruneItemBookings, saveItemBooking } from './search.repository';

/** Also the consumer name in `processed_events`. */
export const BOOKING_EVENTS_QUEUE = 'catalog.booking-events';
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** `booking.accepted.v1` / `booking.confirmed.v1`: only these fields are kept. */
export class BookedItemPayload {
  @IsUUID()
  bookingId!: string;

  @IsUUID()
  itemId!: string;
}

/**
 * Bookings' accepted and confirmed bookings → how often each item was
 * booked lately, which ranks Explore's featured items. Later cancellations
 * still count: the item was wanted.
 */
@Injectable()
export class BookingEventsConsumer
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger('BookingEvents');
  private pruneTimer?: NodeJS.Timeout;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.bus.subscribe({
      queue: BOOKING_EVENTS_QUEUE,
      routingKeys: [
        BookingAcceptedV1.routingKey,
        BookingConfirmedV1.routingKey,
      ],
      handler: (envelope, { routingKey }) => this.handle(envelope, routingKey),
    });
    this.pruneTimer = setInterval(() => void this.prune(), PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
  }

  /** Runs each event at most once; a thrown error means retry, then DLQ. */
  async handle(envelope: EventEnvelope, routingKey: string): Promise<void> {
    if (
      routingKey !== BookingAcceptedV1.routingKey &&
      routingKey !== BookingConfirmedV1.routingKey
    ) {
      throw new InvalidEventError(routingKey, ['routingKey']);
    }
    const { bookingId, itemId } = parsePayload(envelope, BookedItemPayload);
    await handleOnce(this.dataSource, BOOKING_EVENTS_QUEUE, envelope, (tx) =>
      saveItemBooking(tx, bookingId, itemId, envelope.occurredAt),
    );
  }

  /** Forgets bookings past the featured window; never throws. */
  async prune(): Promise<void> {
    try {
      const deleted = await pruneItemBookings(this.dataSource.manager);
      if (deleted > 0) this.logger.log(`Pruned ${deleted} item booking(s)`);
    } catch (err) {
      this.logger.warn(
        `Prune failed: ${err instanceof Error ? err.name : 'unknown'}`,
      );
    }
  }

  beforeApplicationShutdown(): void {
    clearInterval(this.pruneTimer);
  }
}
