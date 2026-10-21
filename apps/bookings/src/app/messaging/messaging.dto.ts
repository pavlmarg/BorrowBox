import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  registerDecorator,
} from 'class-validator';
import {
  CONVERSATIONS_PAGE_MAX,
  MESSAGE_TEXT_MAX_LENGTH,
  MESSAGES_PAGE_MAX,
  RATE_MAX_CENTS,
  REPORT_REASONS,
  type BookOfferRequest,
  type ConversationRef,
  type ListConversationsRequest,
  type ListMessagesRequest,
  type OfferRef,
  type ReportMessageRequest,
  type ReportReason,
  type SendMessageRequest,
  type SendOfferRequest,
  type StartConversationRequest,
} from '@borrowbox/contracts';
import { BOOKING_MAX_HOURS } from '@borrowbox/contracts';

/** Characters (code points), like Postgres' `char_length`, after trimming. */
function TextLength(max: number): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'textLength',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: `${String(propertyName)} must be 1-${max} characters`,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          [...value].length >= 1 &&
          [...value].length <= max,
      },
    });
}

export class StartConversationDto implements StartConversationRequest {
  @IsUUID()
  itemId!: string;
}

export class ConversationRefDto implements ConversationRef {
  @IsUUID()
  conversationId!: string;
}

export class ListConversationsDto implements ListConversationsRequest {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(CONVERSATIONS_PAGE_MAX)
  limit?: number;
}

export class ListMessagesDto
  extends ConversationRefDto
  implements ListMessagesRequest
{
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MESSAGES_PAGE_MAX)
  limit?: number;
}

export class SendMessageDto
  extends ConversationRefDto
  implements SendMessageRequest
{
  @IsUUID()
  messageId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @TextLength(MESSAGE_TEXT_MAX_LENGTH)
  text!: string;
}

export class ReportMessageDto implements ReportMessageRequest {
  @IsUUID()
  messageId!: string;

  @IsIn(REPORT_REASONS)
  reason!: ReportReason;
}

export class SendOfferDto
  extends ConversationRefDto
  implements SendOfferRequest
{
  @IsUUID()
  offerId!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  start!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  end!: string;

  /** Checked against the rate card in OffersService; this only bounds it. */
  @IsInt()
  @Min(0)
  @Max(RATE_MAX_CENTS * BOOKING_MAX_HOURS)
  rentCents!: number;
}

export class OfferRefDto implements OfferRef {
  @IsUUID()
  offerId!: string;
}

export class BookOfferDto extends OfferRefDto implements BookOfferRequest {
  @IsUUID()
  bookingId!: string;
}
