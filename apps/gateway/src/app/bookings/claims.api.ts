import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  CLAIM_DESCRIPTION_MIN_LENGTH,
  CLAIM_MIN_CENTS,
  CLAIM_PHOTOS_MAX,
  CLAIM_REPLY_MAX_LENGTH,
  CLAIM_STATUSES,
  type ClaimAnswer,
  type ClaimExport,
  type ClaimStatus,
  type ClaimView,
} from '@borrowbox/contracts';

// HTTP DTOs for damage claims (ADR-0028): shape checked here; the deposit
// cap, the window and the text rules (contact details) in Bookings.

export class FileClaimBody {
  @ApiProperty({
    minimum: CLAIM_MIN_CENTS,
    description: 'Cents, at most the booking’s deposit',
  })
  @IsInt()
  @Min(CLAIM_MIN_CENTS)
  amountCents!: number;

  @ApiProperty({
    minLength: CLAIM_DESCRIPTION_MIN_LENGTH,
    maxLength: CLAIM_DESCRIPTION_MAX_LENGTH,
    description: 'What is damaged; no phone numbers, emails or links',
  })
  @IsString()
  @MaxLength(CLAIM_DESCRIPTION_MAX_LENGTH + 100)
  description!: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: CLAIM_PHOTOS_MAX,
    description: 'Ready condition photos of this booking (ADR-0027)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CLAIM_PHOTOS_MAX)
  @IsUUID('all', { each: true })
  photoIds?: string[];
}

export class AnswerClaimBody {
  @ApiProperty({
    enum: CLAIM_ANSWERS,
    enumName: 'ClaimAnswer',
    description:
      'AGREE is final and settles at once; DISAGREE waits for an admin',
  })
  @IsIn(CLAIM_ANSWERS)
  answer!: ClaimAnswer;

  @ApiPropertyOptional({ maxLength: CLAIM_REPLY_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CLAIM_REPLY_MAX_LENGTH + 100)
  reply?: string;
}

export class ClaimResponse implements ClaimView {
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty() amountCents!: number;
  @ApiProperty() description!: string;
  @ApiProperty({ type: [String] }) photoIds!: string[];
  @ApiProperty({ enum: CLAIM_STATUSES, enumName: 'ClaimStatus' })
  status!: ClaimStatus;
  @ApiProperty({ type: String, nullable: true }) reply!: string | null;
  @ApiProperty({ format: 'date-time' }) filedAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  answeredAt!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  resolvedAt!: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Once resolved: cents of the deposit that go to the lender',
  })
  awardCents!: number | null;
}

export class MaybeClaimResponse {
  @ApiProperty({ type: ClaimResponse, nullable: true })
  claim!: ClaimResponse | null;
}

export class ClaimExportResponse implements ClaimExport {
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty({ enum: ['RENTER', 'LENDER'] }) role!: 'RENTER' | 'LENDER';
  @ApiProperty() amountCents!: number;
  @ApiProperty({ enum: CLAIM_STATUSES, enumName: 'ClaimStatus' })
  status!: ClaimStatus;
  @ApiProperty({ type: Number, nullable: true }) awardCents!: number | null;
  @ApiProperty({ format: 'date-time' }) filedAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  resolvedAt!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'My description (lender) or reply (renter)',
  })
  myText!: string | null;
}
