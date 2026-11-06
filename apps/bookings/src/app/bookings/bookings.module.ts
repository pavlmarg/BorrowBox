import { Module } from '@nestjs/common';
import {
  BookingsController,
  PublicBookingsController,
} from './bookings.controller';
import { BookingsService } from './bookings.service';

/** Requests, answers, cancellations and the caller's bookings (ADR-0015). */
@Module({
  controllers: [PublicBookingsController, BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
