import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import {
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  type PhotoContentType,
  type ProfilePhotoUpload,
  type ProfilePhotoUploadRequest,
  type ProfilePhotoUrls,
} from '@borrowbox/contracts';

/** Profile photos (ADR-0024): public, shown wherever the name is. */
export class ProfilePhotoUrlsResponse implements ProfilePhotoUrls {
  @ApiProperty({ description: '96 × 96 px WebP' }) small!: string;
  @ApiProperty({ description: '512 × 512 px WebP' }) large!: string;
}

export class ProfilePhotoUploadBody implements ProfilePhotoUploadRequest {
  @ApiProperty({ enum: PHOTO_CONTENT_TYPES, enumName: 'PhotoContentType' })
  @IsIn(PHOTO_CONTENT_TYPES)
  contentType!: PhotoContentType;

  @ApiProperty({ minimum: 1, maximum: PHOTO_MAX_BYTES })
  @IsInt()
  @Min(1)
  @Max(PHOTO_MAX_BYTES)
  sizeBytes!: number;
}

export class ProfilePhotoUploadResponse implements ProfilePhotoUpload {
  @ApiProperty({ description: 'PUT the file here, before expiresAt' })
  uploadUrl!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Headers the PUT must send exactly',
  })
  uploadHeaders!: Record<string, string>;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}
