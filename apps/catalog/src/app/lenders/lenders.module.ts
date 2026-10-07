import { Module } from '@nestjs/common';
import { UserEventsConsumer } from './user-events.consumer';

/** The lender-name read model, kept from Identity's user events. */
@Module({ providers: [UserEventsConsumer] })
export class LendersModule {}
