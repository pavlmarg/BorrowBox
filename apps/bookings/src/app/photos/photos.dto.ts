import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';
import {
  HANDOFF_PHASES,
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  type BookingRef,
  type ConditionPhotoRef,
  type ConditionPhotoUploadRequest,
  type HandoffPhase,
  type PhotoContentType,
} from '@borrowbox/contracts';

export class ConditionPhotoUploadDto implements ConditionPhotoUploadRequest {
  @IsUUID()
  bookingId!: string;

  @IsUUID()
  photoId!: string;

  @IsIn(HANDOFF_PHASES)
  phase!: HandoffPhase;

  @IsIn(PHOTO_CONTENT_TYPES)
  contentType!: PhotoContentType;

  @IsInt()
  @Min(1)
  @Max(PHOTO_MAX_BYTES)
  sizeBytes!: number;
}

export class ConditionPhotoRefDto implements ConditionPhotoRef {
  @IsUUID()
  bookingId!: string;

  @IsUUID()
  photoId!: string;
}

export class PhotosOfBookingDto implements BookingRef {
  @IsUUID()
  bookingId!: string;
}
