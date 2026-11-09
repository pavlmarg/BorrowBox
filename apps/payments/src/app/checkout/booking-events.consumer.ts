import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import type { DataSource } from 'typeorm';
import {
  BookingAcceptedV1,
  BookingCancelledV1,
  BookingExpiredV1,
  BookingPaidV1,
  ITEM_TITLE_MAX_LENGTH,
  type BookingSnapshotV1,
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
import { saveBooking, type BookingPaymentState } from './bookings.repository';
import { lockPaymentByBooking, updatePayment } from './payments.repository';

/** Also the consumer name in `processed_events`. */
export const BOOKING_EVENTS_QUEUE = 'payments.booking-events';

/** The booking as `booking.*.v1` carries it: only what Payments keeps. */
class BookingPayload implements BookingSnapshotV1 {
  @IsUUID() bookingId!: string;
  @IsUUID() itemId!: string;
  @IsString() @MaxLength(ITEM_TITLE_MAX_LENGTH) itemTitle!: string;
  @IsUUID() lenderId!: string;
  @IsUUID() renterId!: string;
  @IsISO8601({ strict: true }) start!: string;
  @IsISO8601({ strict: true }) end!: string;
  @IsInt() @Min(0) rentCents!: number;
  @IsInt() @Min(0) depositCents!: number;
  @IsOptional() @IsInt() @Min(0) feeCents?: number;
  @IsOptional() @IsInt() @Min(0) lenderFeeCents?: number;
  @IsOptional() @IsISO8601({ strict: true }) payBy?: string;
}

const STATE_BY_ROUTING_KEY: Record<string, BookingPaymentState> = {
  [BookingAcceptedV1.routingKey]: 'AWAITING_PAYMENT',
  [BookingPaidV1.routingKey]: 'PAID',
  [BookingExpiredV1.routingKey]: 'CLOSED',
  [BookingCancelledV1.routingKey]: 'CLOSED',
};

/**
 * Bookings' events (ADR-0019): which bookings wait for payment, are paid
 * or closed. When a booking closes:
 * - an unpaid PaymentIntent is cancelled at Stripe (by the worker), so the
 *   renter can't pay a booking that no longer exists;
 * - a payment that already succeeded is due a refund (PR C).
 * Database only: Stripe is called by the worker.
 */
@Injectable()
export class BookingEventsConsumer implements OnApplicationBootstrap {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.bus.subscribe({
      queue: BOOKING_EVENTS_QUEUE,
      routingKeys: Object.keys(STATE_BY_ROUTING_KEY),
      handler: (envelope, { routingKey }) => this.handle(envelope, routingKey),
    });
  }

  /** Runs each event at most once; a thrown error means retry, then DLQ. */
  async handle(envelope: EventEnvelope, routingKey: string): Promise<void> {
    const state = STATE_BY_ROUTING_KEY[routingKey];
    if (!state) throw new InvalidEventError(routingKey, ['routingKey']);
    const booking = parsePayload(envelope, BookingPayload);
    await handleOnce(
      this.dataSource,
      BOOKING_EVENTS_QUEUE,
      envelope,
      async (tx) => {
        await saveBooking(tx, booking, state);
        if (state !== 'CLOSED') return;
        const payment = await lockPaymentByBooking(tx, booking.bookingId);
        if (!payment) return;
        if (payment.status === 'SUCCEEDED') {
          await updatePayment(tx, payment.id, { status: 'NEEDS_REFUND' });
        } else if (
          payment.status === 'REQUIRES_PAYMENT' ||
          payment.status === 'PROCESSING'
        ) {
          await updatePayment(tx, payment.id, {
            status: 'CANCELLED',
            cancelPending: true,
          });
        }
      },
    );
  }
}
