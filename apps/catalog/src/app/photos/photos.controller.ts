import { Controller, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CurrentUser, RpcJwtAuthGuard, type AuthUser } from '@borrowbox/auth';
import {
  CatalogRpc,
  type PhotoUpload,
  type PhotoView,
} from '@borrowbox/contracts';
import {
  CreatePhotoUploadDto,
  PhotoRefDto,
  ReorderPhotosDto,
} from './photos.dto';
import { PhotosService } from './photos.service';

/** Photos of the caller's own items; ownership is checked in PhotosService. */
@Controller()
@UseGuards(RpcJwtAuthGuard)
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @MessagePattern(CatalogRpc.createPhotoUpload)
  createUpload(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: CreatePhotoUploadDto,
  ): Promise<PhotoUpload> {
    return this.photos.createUpload(user, dto);
  }

  @MessagePattern(CatalogRpc.confirmPhoto)
  confirm(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: PhotoRefDto,
  ): Promise<PhotoView> {
    return this.photos.confirm(user, dto);
  }

  @MessagePattern(CatalogRpc.deletePhoto)
  delete(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: PhotoRefDto,
  ): Promise<void> {
    return this.photos.delete(user, dto);
  }

  @MessagePattern(CatalogRpc.reorderPhotos)
  reorder(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ReorderPhotosDto,
  ): Promise<PhotoView[]> {
    return this.photos.reorder(user, dto);
  }
}
