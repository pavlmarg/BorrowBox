import {
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  IsString,
} from 'class-validator';
import {
  HANDOFF_ANSWERS,
  HANDOFF_CODE_LENGTH,
  HANDOFF_PHASES,
  type HandoffAnswer,
  type HandoffAnswerRequest,
  type HandoffPhase,
  type HandoffScanRequest,
  type HandoffTokenRequest,
} from '@borrowbox/contracts';

export class HandoffTokenDto implements HandoffTokenRequest {
  @IsUUID()
  bookingId!: string;

  @IsIn(HANDOFF_PHASES)
  phase!: HandoffPhase;
}

/** A scanned token, or a typed code with its phase; checked in full by HandoffService. */
export class HandoffScanDto implements HandoffScanRequest {
  @IsUUID()
  bookingId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  token?: string;

  @IsOptional()
  @IsIn(HANDOFF_PHASES)
  phase?: HandoffPhase;

  @IsOptional()
  @Matches(new RegExp(`^\\d{${HANDOFF_CODE_LENGTH}}$`), {
    message: `code must be ${HANDOFF_CODE_LENGTH} digits`,
  })
  code?: string;
}

export class HandoffAnswerDto implements HandoffAnswerRequest {
  @IsUUID()
  bookingId!: string;

  @IsIn(HANDOFF_PHASES)
  phase!: HandoffPhase;

  @IsIn(HANDOFF_ANSWERS)
  answer!: HandoffAnswer;
}
