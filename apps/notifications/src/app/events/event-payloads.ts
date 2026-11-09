import {
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  BOOKING_CANCEL_REASONS,
  BOOKING_DECLINE_REASONS,
  BOOKING_EXPIRE_REASONS,
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  ITEM_TITLE_MAX_LENGTH,
  LOCALES,
  type BookingCancelReason,
  type BookingDeclineReason,
  type BookingExpireReason,
  type BookingSnapshotV1,
  type ConversationUnreadV1Payload,
  type Locale,
  type OfferSentV1Payload,
  type PaymentFailedV1Payload,
} from '@borrowbox/contracts';

/**
 * Other services' events as Notifications reads them, checked at runtime
 * with `parsePayload` (`@borrowbox/service-kit`).
 */

/** `user.registered.v1`. */
export class RegisteredPayload {
  @IsUUID()
  userId!: string;

  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName!: string;

  @IsIn(LOCALES)
  locale!: Locale;
}

/** `user.profile_updated.v1`. */
export class ProfilePayload {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName!: string;

  @IsIn(LOCALES)
  locale!: Locale;
}

/** `user.deletion_requested.v1`. */
export class UserIdPayload {
  @IsUUID()
  userId!: string;
}

/** Every `booking.*.v1`. */
export class BookingPayload implements BookingSnapshotV1 {
  @IsUUID()
  bookingId!: string;

  @IsUUID()
  itemId!: string;

  @IsString()
  @MaxLength(ITEM_TITLE_MAX_LENGTH)
  itemTitle!: string;

  @IsUUID()
  lenderId!: string;

  @IsUUID()
  renterId!: string;

  @IsISO8601({ strict: true })
  start!: string;

  @IsISO8601({ strict: true })
  end!: string;

  @IsInt()
  @Min(0)
  rentCents!: number;

  @IsInt()
  @Min(0)
  depositCents!: number;

  @IsOptional()
  @IsUUID()
  offerId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  feeCents?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  payBy?: string;
}

/** `payment.failed.v1`. */
export class PaymentFailedPayload implements PaymentFailedV1Payload {
  @IsUUID()
  bookingId!: string;

  @IsUUID()
  renterId!: string;

  @IsUUID()
  lenderId!: string;

  @IsString()
  @MaxLength(ITEM_TITLE_MAX_LENGTH)
  itemTitle!: string;

  @IsInt()
  @Min(0)
  amountCents!: number;

  @IsISO8601({ strict: true })
  payBy!: string;
}

export class DeclinedPayload extends BookingPayload {
  @IsIn(BOOKING_DECLINE_REASONS)
  reason!: BookingDeclineReason;
}

export class ExpiredPayload extends BookingPayload {
  @IsIn(BOOKING_EXPIRE_REASONS)
  reason!: BookingExpireReason;
}

export class CancelledPayload extends BookingPayload {
  @IsIn(BOOKING_CANCEL_REASONS)
  reason!: BookingCancelReason;
}

/** `offer.sent.v1`. */
export class OfferSentPayload implements OfferSentV1Payload {
  @IsUUID()
  offerId!: string;

  @IsUUID()
  conversationId!: string;

  @IsUUID()
  itemId!: string;

  @IsString()
  @MaxLength(ITEM_TITLE_MAX_LENGTH)
  itemTitle!: string;

  @IsUUID()
  lenderId!: string;

  @IsUUID()
  renterId!: string;

  @IsISO8601({ strict: true })
  start!: string;

  @IsISO8601({ strict: true })
  end!: string;

  @IsInt()
  @Min(0)
  rentCents!: number;

  @IsInt()
  @Min(0)
  depositCents!: number;

  @IsISO8601({ strict: true })
  expiresAt!: string;
}

/** `conversation.unread.v1`. */
export class UnreadPayload implements ConversationUnreadV1Payload {
  @IsUUID()
  conversationId!: string;

  @IsUUID()
  itemId!: string;

  @IsString()
  @MaxLength(ITEM_TITLE_MAX_LENGTH)
  itemTitle!: string;

  @IsUUID()
  recipientId!: string;

  @IsUUID()
  senderId!: string;

  @IsInt()
  @Min(1)
  unreadCount!: number;
}
