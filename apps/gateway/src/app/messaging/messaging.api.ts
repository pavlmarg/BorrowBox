import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  registerDecorator,
} from 'class-validator';
import {
  BOOKING_MAX_HOURS,
  CONVERSATIONS_PAGE_MAX,
  EMAIL_KINDS,
  LOCALES,
  MESSAGE_KINDS,
  MESSAGE_TEXT_MAX_LENGTH,
  MESSAGES_PAGE_MAX,
  OFFER_STATUSES,
  RATE_MAX_CENTS,
  REPORT_REASONS,
  SYSTEM_MESSAGE_CODES,
  charLength,
  type EmailKind,
  type Locale,
  type MessageKind,
  type OfferStatus,
  type ReportReason,
  type SystemMessageCode,
} from '@borrowbox/contracts';
import { BookingPartyResponse, PeriodQuery } from '../bookings/bookings.api';

// HTTP DTOs for chat and offers (ADR-0017, ADR-0018), and Notifications'
// export: validated here, again in the service, and the source of the
// OpenAPI spec.

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
          charLength(value) >= 1 &&
          charLength(value) <= max,
      },
    });
}

// --- Requests ---------------------------------------------------------------------

export class PageQuery {
  @ApiPropertyOptional({ description: "The previous page's nextCursor" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: CONVERSATIONS_PAGE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CONVERSATIONS_PAGE_MAX)
  limit?: number;
}

export class MessagesPageQuery {
  @ApiPropertyOptional({
    description: "The previous page's nextCursor (older)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MESSAGES_PAGE_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MESSAGES_PAGE_MAX)
  limit?: number;
}

export class SendMessageBody {
  @ApiProperty({
    format: 'uuid',
    description: 'A new random UUID per message; repeating it is harmless',
  })
  @IsUUID()
  messageId!: string;

  @ApiProperty({ minLength: 1, maxLength: MESSAGE_TEXT_MAX_LENGTH })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @TextLength(MESSAGE_TEXT_MAX_LENGTH)
  text!: string;
}

export class ReportMessageBody {
  @ApiProperty({ enum: REPORT_REASONS, enumName: 'ReportReason' })
  @IsIn(REPORT_REASONS)
  reason!: ReportReason;
}

export class SendOfferBody extends PeriodQuery {
  @ApiProperty({
    format: 'uuid',
    description: 'A new random UUID per offer; repeating it is harmless',
  })
  @IsUUID()
  offerId!: string;

  @ApiProperty({
    minimum: 0,
    description: 'At most what the rate card charges for the period',
  })
  @IsInt()
  @Min(0)
  @Max(RATE_MAX_CENTS * BOOKING_MAX_HOURS)
  rentCents!: number;
}

export class BookOfferBody {
  @ApiProperty({ format: 'uuid', description: 'A new random UUID' })
  @IsUUID()
  bookingId!: string;
}

// --- Responses --------------------------------------------------------------------

export class OfferViewResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) conversationId!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ format: 'date-time' }) start!: string;
  @ApiProperty({ format: 'date-time' }) end!: string;
  @ApiProperty() rentCents!: number;
  @ApiProperty() depositCents!: number;
  @ApiProperty({ description: "The renter's service fee (ADR-0020)" })
  feeCents!: number;
  @ApiProperty({
    description: 'What the renter would pay: rent + deposit + fee',
  })
  totalCents!: number;
  @ApiProperty({ description: 'What the rate card charges for the period' })
  listRentCents!: number;
  @ApiProperty({ enum: OFFER_STATUSES, enumName: 'OfferStatus' })
  status!: OfferStatus;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  bookingId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class MessageViewResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) conversationId!: string;
  @ApiProperty({ enum: MESSAGE_KINDS, enumName: 'MessageKind' })
  kind!: MessageKind;
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  senderId!: string | null;
  @ApiProperty({ description: 'True if the reader sent it' }) mine!: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'TEXT only; contact details masked until a booking goes ahead; null once deleted',
  })
  text!: string | null;
  @ApiProperty() deleted!: boolean;
  @ApiProperty({
    enum: SYSTEM_MESSAGE_CODES,
    enumName: 'SystemMessageCode',
    nullable: true,
  })
  systemCode!: SystemMessageCode | null;
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  bookingId!: string | null;
  @ApiProperty({ type: OfferViewResponse, nullable: true })
  offer!: OfferViewResponse | null;
  @ApiProperty({ format: 'date-time' }) sentAt!: string;
}

export class ConversationViewResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() itemTitle!: string;
  @ApiProperty({ enum: ['RENTER', 'LENDER'] }) role!: 'RENTER' | 'LENDER';
  @ApiProperty({ type: BookingPartyResponse }) other!: BookingPartyResponse;
  @ApiProperty({ type: MessageViewResponse, nullable: true })
  lastMessage!: MessageViewResponse | null;
  @ApiProperty({ format: 'date-time' }) lastMessageAt!: string;
  @ApiProperty() unreadCount!: number;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  otherReadAt!: string | null;
  @ApiProperty({ description: 'Read-only: item deleted or an account erased' })
  closed!: boolean;
  @ApiProperty({ type: OfferViewResponse, nullable: true })
  openOffer!: OfferViewResponse | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ListConversationsResponse {
  @ApiProperty({ type: [ConversationViewResponse] })
  conversations!: ConversationViewResponse[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class ListMessagesResponse {
  @ApiProperty({ type: [MessageViewResponse], description: 'Newest first' })
  messages!: MessageViewResponse[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class MarkReadResponse {
  @ApiProperty({ format: 'date-time' }) readAt!: string;
}

export class UnreadCountResponse {
  @ApiProperty() total!: number;
}

export class ExportedMessage {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true }) text!: string | null;
  @ApiProperty({ format: 'date-time' }) sentAt!: string;
}

export class ExportedConversation {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() itemTitle!: string;
  @ApiProperty({ enum: ['RENTER', 'LENDER'] }) role!: 'RENTER' | 'LENDER';
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [ExportedMessage] }) myMessages!: ExportedMessage[];
}

export class ExportedReport {
  @ApiProperty({ format: 'uuid' }) messageId!: string;
  @ApiProperty({ enum: REPORT_REASONS, enumName: 'ReportReason' })
  reason!: ReportReason;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class MessagingDataExportResponse {
  @ApiProperty({ format: 'date-time' }) exportedAt!: string;
  @ApiProperty({ type: [ExportedConversation] })
  conversations!: ExportedConversation[];
  @ApiProperty({ type: [OfferViewResponse] }) offers!: OfferViewResponse[];
  @ApiProperty({ type: [ExportedReport] }) reports!: ExportedReport[];
}

export class ExportedRecipient {
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ enum: LOCALES, enumName: 'Locale' }) locale!: Locale;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ExportedEmail {
  @ApiProperty({ enum: EMAIL_KINDS, enumName: 'EmailKind' }) kind!: EmailKind;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  sentAt!: string | null;
}

export class NotificationsDataExportResponse {
  @ApiProperty({ format: 'date-time' }) exportedAt!: string;
  @ApiProperty({ type: ExportedRecipient, nullable: true })
  recipient!: ExportedRecipient | null;
  @ApiProperty({ type: [ExportedEmail] }) emails!: ExportedEmail[];
}
