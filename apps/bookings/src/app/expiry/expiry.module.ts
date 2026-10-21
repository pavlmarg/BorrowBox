import { Global, Module } from '@nestjs/common';
import { BookingExpiry } from './booking-expiry';
import { ExpiryQueue } from './expiry-queue';
import { ExpiryWorker } from './expiry-worker';

/** Request and payment-less expiry (ADR-0015). Global so commands can schedule checks. */
@Global()
@Module({
  providers: [ExpiryQueue, BookingExpiry, ExpiryWorker],
  exports: [ExpiryQueue, BookingExpiry],
})
export class ExpiryModule {}
