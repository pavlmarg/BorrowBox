import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  BOOKING_REVIEW_REASONS,
  HANDOFF_ANSWERS,
  HANDOFF_CODE_LENGTH,
  HANDOFF_PHASES,
  type BookingReviewReason,
  type HandoffAnswer,
  type HandoffMethod,
  type HandoffPhase,
} from '@borrowbox/contracts';

// HTTP DTOs for pickups and returns (ARCHITECTURE.md §5, ADR-0026):
// validated here, again by Bookings, and the source of the OpenAPI spec.

const CODE_PATTERN = new RegExp(`^\\d{${HANDOFF_CODE_LENGTH}}$`);
const HANDOFF_METHODS: HandoffMethod[] = [
  'QR',
  'CODE',
  'CONFIRMED',
  'ADMIN',
  'RETURN_SCAN',
];

// --- Requests ---------------------------------------------------------------

export class HandoffTokenQuery {
  @ApiProperty({
    enum: HANDOFF_PHASES,
    enumName: 'HandoffPhase',
    description: 'The lender shows the PICKUP code, the renter the RETURN code',
  })
  @IsIn(HANDOFF_PHASES)
  phase!: HandoffPhase;
}

/** A scanned QR token, or a typed 6-digit code with its phase. */
export class HandoffScanBody {
  @ApiPropertyOptional({ description: 'What the QR code holds, as it is' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  token?: string;

  @ApiPropertyOptional({ enum: HANDOFF_PHASES, enumName: 'HandoffPhase' })
  @IsOptional()
  @IsIn(HANDOFF_PHASES)
  phase?: HandoffPhase;

  @ApiPropertyOptional({
    example: '048213',
    description: 'The 6-digit code under the QR code, with `phase`',
  })
  @IsOptional()
  @Matches(CODE_PATTERN, { message: 'code must be 6 digits' })
  code?: string;
}

export class HandoffAnswerBody {
  @ApiProperty({ enum: HANDOFF_PHASES, enumName: 'HandoffPhase' })
  @IsIn(HANDOFF_PHASES)
  phase!: HandoffPhase;

  @ApiProperty({
    enum: HANDOFF_ANSWERS,
    enumName: 'HandoffAnswer',
    description: 'Did the handoff happen? Final once given',
  })
  @IsIn(HANDOFF_ANSWERS)
  answer!: HandoffAnswer;
}

// --- Responses --------------------------------------------------------------

export class HandoffTokenResponse {
  @ApiProperty({ description: 'Goes into the QR code as it is' })
  token!: string;
  @ApiProperty({ example: '048213', description: 'The fallback code' })
  code!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ description: 'Fetch the next token after this many seconds' })
  refreshAfterSeconds!: number;
}

export class HandoffQuestionResponse {
  @ApiProperty({ enum: HANDOFF_PHASES, enumName: 'HandoffPhase' })
  phase!: HandoffPhase;
  @ApiProperty({
    enum: HANDOFF_ANSWERS,
    enumName: 'HandoffAnswer',
    nullable: true,
  })
  myAnswer!: HandoffAnswer | null;
  @ApiProperty({
    description: 'Whether the other person answered (never what)',
  })
  otherAnswered!: boolean;
  @ApiProperty({
    format: 'date-time',
    description: "When the outcome falls due if the answers haven't decided it",
  })
  decideAt!: string;
}

export class BookingHandoffResponse {
  @ApiProperty({
    format: 'date-time',
    description: 'When the pickup can first be scanned',
  })
  pickupOpensAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  pickedUpAt!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  returnedAt!: string | null;
  @ApiProperty({
    format: 'date-time',
    nullable: true,
    type: String,
    description: 'While RETURNED: until when the lender can report damage',
  })
  claimUntil!: string | null;
  @ApiProperty({
    type: HandoffQuestionResponse,
    nullable: true,
    description: 'While both are asked whether an unscanned handoff happened',
  })
  question!: HandoffQuestionResponse | null;
  @ApiProperty({
    enum: BOOKING_REVIEW_REASONS,
    enumName: 'BookingReviewReason',
    nullable: true,
    description: 'Set while an admin has to decide what happened',
  })
  review!: BookingReviewReason | null;
}

export class ActiveRentalsResponse {
  @ApiProperty() active!: boolean;
}

export class BookingHandoffExportResponse {
  @ApiProperty({ format: 'uuid' }) bookingId!: string;
  @ApiProperty({ enum: HANDOFF_PHASES, enumName: 'HandoffPhase' })
  phase!: HandoffPhase;
  @ApiProperty({
    enum: HANDOFF_METHODS,
    enumName: 'HandoffMethod',
    nullable: true,
  })
  method!: HandoffMethod | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  at!: string | null;
  @ApiProperty({
    enum: HANDOFF_ANSWERS,
    enumName: 'HandoffAnswer',
    nullable: true,
  })
  answer!: HandoffAnswer | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  answeredAt!: string | null;
}
