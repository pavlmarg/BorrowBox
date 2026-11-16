import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CLAIM_ANSWERS,
  CLAIM_DESCRIPTION_MAX_LENGTH,
  CLAIM_MIN_CENTS,
  CLAIM_PHOTOS_MAX,
  CLAIM_REPLY_MAX_LENGTH,
  type AnswerClaimRequest,
  type BookingRef,
  type ClaimAnswer,
  type FileClaimRequest,
} from '@borrowbox/contracts';

/** Shape only; the deposit cap and the text rules are checked in ClaimsService. */
export class FileClaimDto implements FileClaimRequest {
  @IsUUID()
  bookingId!: string;

  @IsInt()
  @Min(CLAIM_MIN_CENTS)
  amountCents!: number;

  @IsString()
  @MaxLength(CLAIM_DESCRIPTION_MAX_LENGTH + 100)
  description!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CLAIM_PHOTOS_MAX)
  @IsUUID('all', { each: true })
  photoIds?: string[];
}

export class AnswerClaimDto implements AnswerClaimRequest {
  @IsUUID()
  bookingId!: string;

  @IsIn(CLAIM_ANSWERS)
  answer!: ClaimAnswer;

  @IsOptional()
  @IsString()
  @MaxLength(CLAIM_REPLY_MAX_LENGTH + 100)
  reply?: string;
}

export class ClaimRefDto implements BookingRef {
  @IsUUID()
  bookingId!: string;
}
