import { Module } from '@nestjs/common';
import { ItemEventsConsumer } from './item-events.consumer';
import { UserEventsConsumer } from './user-events.consumer';

/** Items and users as Bookings knows them, kept from Catalog's and Identity's events. */
@Module({ providers: [ItemEventsConsumer, UserEventsConsumer] })
export class ReadModelsModule {}
