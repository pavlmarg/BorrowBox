import { Module } from '@nestjs/common';
import { PhotoMaintenance } from './photo-maintenance';
import { PhotoProcessor } from './photo-processor';
import { PhotoQueue } from './photo-queue';
import { PhotoStorage } from './photo-storage';
import { PhotoWorker } from './photo-worker';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

/** Condition photos at pickup and return (ADR-0027). */
@Module({
  controllers: [PhotosController],
  providers: [
    PhotosService,
    PhotoStorage,
    PhotoQueue,
    PhotoProcessor,
    PhotoMaintenance,
    PhotoWorker,
  ],
  exports: [PhotosService],
})
export class PhotosModule {}
