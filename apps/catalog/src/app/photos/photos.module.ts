import { Global, Module } from '@nestjs/common';
import { PhotoMaintenance } from './photo-maintenance';
import { PhotoProcessor } from './photo-processor';
import { PhotoQueue } from './photo-queue';
import { PhotoStorage } from './photo-storage';
import { PhotoWorker } from './photo-worker';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

/**
 * The photo pipeline (ADR-0009). Global so item deletion and account
 * erasure can queue file cleanups.
 */
@Global()
@Module({
  controllers: [PhotosController],
  providers: [
    PhotoStorage,
    PhotoQueue,
    PhotoProcessor,
    PhotoMaintenance,
    PhotoWorker,
    PhotosService,
  ],
  exports: [PhotoQueue],
})
export class PhotosModule {}
