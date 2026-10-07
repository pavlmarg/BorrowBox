import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  ITEM_PHOTOS_MAX,
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  type CreatePhotoUploadRequest,
  type PhotoContentType,
  type PhotoRef,
  type ReorderPhotosRequest,
} from '@borrowbox/contracts';

export class CreatePhotoUploadDto implements CreatePhotoUploadRequest {
  @IsUUID()
  itemId!: string;

  /** Signed into the upload URL: storage refuses any other type. */
  @IsIn(PHOTO_CONTENT_TYPES)
  contentType!: PhotoContentType;

  /** As declared; the worker checks the real size. */
  @IsInt()
  @Min(1)
  @Max(PHOTO_MAX_BYTES)
  sizeBytes!: number;
}

export class PhotoRefDto implements PhotoRef {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  photoId!: string;
}

export class ReorderPhotosDto implements ReorderPhotosRequest {
  @IsUUID()
  itemId!: string;

  /** Every photo of the item, in the new order. */
  @IsArray()
  @ArrayMaxSize(ITEM_PHOTOS_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  photoIds!: string[];
}
