import { Module } from '@nestjs/common';
import {
  BookingsController,
  PublicBookingsController,
} from './bookings.controller';
import { BookingsService } from './bookings.service';
import { PaymentEventsConsumer } from './payment-events.consumer';

/** Requests, answers, cancellations, payment, and the caller's bookings (ADR-0015, ADR-0019). */
@Module({
  controllers: [PublicBookingsController, BookingsController],
  providers: [BookingsService, PaymentEventsConsumer],
})
export class BookingsModule {}
