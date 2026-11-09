import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { IsInt, IsUUID, Min } from 'class-validator';
import type { DataSource } from 'typeorm';
import {
  PaymentAccountReadyV1,
  PaymentAccountRestrictedV1,
  PaymentCapturedV1,
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
import { ChatPublisher, ChatPushes } from '../messaging/chat-publisher';
import { UserIdPayload } from '../read-models/event-payloads';
import { savePayoutsReady } from '../read-models/users.repository';
import { moveBooking } from './booking-transitions';
import { lockBooking } from './bookings.repository';

/** Also the consumer name in `processed_events`. */
export const PAYMENT_EVENTS_QUEUE = 'bookings.payment-events';

class PaymentCapturedPayload {
  @IsUUID()
  bookingId!: string;

  @IsInt()
  @Min(0)
  amountCents!: number;
}

/**
 * Payments' events (ADR-0019):
 * - which lenders can be paid, for accepting paid bookings (the newest
 *   event wins);
 * - `payment.captured`: an accepted booking is paid and goes ahead (PAID).
 *   A payment for a booking that closed meanwhile (expired, cancelled) is
 *   left alone: Payments sees the booking closed and refunds it.
 */
@Injectable()
export class PaymentEventsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger('PaymentEvents');

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly chat: ChatPublisher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.bus.subscribe({
      queue: PAYMENT_EVENTS_QUEUE,
      routingKeys: [
        PaymentAccountReadyV1.routingKey,
        PaymentAccountRestrictedV1.routingKey,
        PaymentCapturedV1.routingKey,
      ],
      handler: (envelope, { routingKey }) => this.handle(envelope, routingKey),
    });
  }

  /** Runs each event at most once; a thrown error means retry, then DLQ. */
  async handle(envelope: EventEnvelope, routingKey: string): Promise<void> {
    switch (routingKey) {
      case PaymentAccountReadyV1.routingKey:
      case PaymentAccountRestrictedV1.routingKey: {
        const { userId } = parsePayload(envelope, UserIdPayload);
        const ready = routingKey === PaymentAccountReadyV1.routingKey;
        await handleOnce(
          this.dataSource,
          PAYMENT_EVENTS_QUEUE,
          envelope,
          (tx) => savePayoutsReady(tx, userId, ready, envelope.occurredAt),
        );
        return;
      }
      case PaymentCapturedV1.routingKey:
        return this.paid(envelope);
      default:
        throw new InvalidEventError(routingKey, ['routingKey']);
    }
  }

  private async paid(envelope: EventEnvelope): Promise<void> {
    const { bookingId, amountCents } = parsePayload(
      envelope,
      PaymentCapturedPayload,
    );
    const pushes = new ChatPushes();
    let moved = false;
    const ran = await handleOnce(
      this.dataSource,
      PAYMENT_EVENTS_QUEUE,
      envelope,
      async (tx) => {
        const booking = await lockBooking(tx, bookingId);
        if (!booking) {
          this.logger.error(`Payment for unknown booking ${bookingId}`);
          return;
        }
        if (booking.status !== 'ACCEPTED') {
          // Already PAID (a repeat), or closed meanwhile: Payments refunds it.
          if (booking.status !== 'PAID') {
            this.logger.warn(
              `Payment for booking ${bookingId} arrived while it was ${booking.status}`,
            );
          }
          return;
        }
        const due =
          booking.rent_cents + booking.deposit_cents + booking.fee_cents;
        if (amountCents < due) {
          // A bug, never a user's doing: keep it ACCEPTED and say so loudly.
          this.logger.error(
            `Payment for booking ${bookingId} is ${amountCents} cents, ${due} due; not marked paid`,
          );
          return;
        }
        await moveBooking(
          tx,
          booking,
          { to: 'PAID' },
          { causedBy: envelope },
          pushes,
        );
        moved = true;
      },
    );
    if (ran && moved) await this.chat.flush(pushes);
  }
}
