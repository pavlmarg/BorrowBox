import { Module } from '@nestjs/common';
import { BookingEventsConsumer } from './booking-events.consumer';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** Public search and item pages, and how often items get booked (featured). */
@Module({
  controllers: [SearchController],
  providers: [SearchService, BookingEventsConsumer],
})
export class SearchModule {}
