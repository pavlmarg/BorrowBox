import { Controller, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CurrentUser, RpcJwtAuthGuard, type AuthUser } from '@borrowbox/auth';
import {
  BookingsRpc,
  type ConditionPhotoUpload,
  type ConditionPhotoView,
  type ConditionPhotosView,
} from '@borrowbox/contracts';
import {
  ConditionPhotoRefDto,
  ConditionPhotoUploadDto,
  PhotosOfBookingDto,
} from './photos.dto';
import { PhotosService } from './photos.service';

/**
 * Condition photos (ADR-0027). The caller comes from the re-verified access
 * token only; that they are one of the booking's two people is checked in
 * PhotosService.
 */
@Controller()
@UseGuards(RpcJwtAuthGuard)
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @MessagePattern(BookingsRpc.photoUpload)
  upload(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ConditionPhotoUploadDto,
  ): Promise<ConditionPhotoUpload> {
    return this.photos.requestUpload(user, dto);
  }

  @MessagePattern(BookingsRpc.photoConfirm)
  confirm(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ConditionPhotoRefDto,
  ): Promise<ConditionPhotoView> {
    return this.photos.confirm(user, dto.bookingId, dto.photoId);
  }

  @MessagePattern(BookingsRpc.photoRemove)
  async remove(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ConditionPhotoRefDto,
  ): Promise<void> {
    await this.photos.remove(user, dto.bookingId, dto.photoId);
  }

  @MessagePattern(BookingsRpc.photoList)
  list(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: PhotosOfBookingDto,
  ): Promise<ConditionPhotosView> {
    return this.photos.list(user, dto.bookingId);
  }
}
