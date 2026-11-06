import { Global, Module } from '@nestjs/common';
import { ChatMaintenance } from './chat-maintenance';
import { ChatPublisher } from './chat-publisher';
import { ChatQueue } from './chat-queue';
import { ChatWorker } from './chat-worker';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { OffersService } from './offers.service';

/**
 * In-app chat and price offers (ADR-0017, ADR-0018), inside Bookings until
 * Messaging becomes its own service. Global so booking changes can add
 * system lines and push them live.
 */
@Global()
@Module({
  controllers: [MessagingController],
  providers: [
    ChatPublisher,
    ChatQueue,
    ChatMaintenance,
    ChatWorker,
    MessagingService,
    OffersService,
  ],
  exports: [ChatPublisher],
})
export class MessagingModule {}
