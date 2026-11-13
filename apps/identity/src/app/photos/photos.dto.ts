import { IsIn, IsInt, Max, Min } from 'class-validator';
import {
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  type PhotoContentType,
  type ProfilePhotoUploadRequest,
} from '@borrowbox/contracts';

export class ProfilePhotoUploadDto implements ProfilePhotoUploadRequest {
  /** Signed into the upload URL: storage refuses any other type. */
  @IsIn(PHOTO_CONTENT_TYPES)
  contentType!: PhotoContentType;

  /** As declared; the worker checks the real size. */
  @IsInt()
  @Min(1)
  @Max(PHOTO_MAX_BYTES)
  sizeBytes!: number;
}
