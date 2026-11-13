import { Controller, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CurrentUser, RpcJwtAuthGuard, type AuthUser } from '@borrowbox/auth';
import {
  IdentityRpc,
  type ProfilePhotoUpload,
  type UserProfile,
} from '@borrowbox/contracts';
import { CorrelationIdPipe } from '@borrowbox/service-kit';
import { ProfilePhotoUploadDto } from './photos.dto';
import { PhotosService } from './photos.service';

/** `me.photo.*`: the caller's own profile photo, identified by the access token only. */
@Controller()
@UseGuards(RpcJwtAuthGuard)
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @MessagePattern(IdentityRpc.requestPhotoUpload)
  requestUpload(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ProfilePhotoUploadDto,
  ): Promise<ProfilePhotoUpload> {
    return this.photos.requestUpload(user, dto);
  }

  @MessagePattern(IdentityRpc.confirmPhoto)
  confirm(@CurrentUser() user: AuthUser): Promise<UserProfile> {
    return this.photos.confirm(user);
  }

  @MessagePattern(IdentityRpc.removePhoto)
  remove(
    @CurrentUser() user: AuthUser,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<UserProfile> {
    return this.photos.remove(user, correlationId);
  }
}
