import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  BOOKING_CANCEL_REASONS,
  BOOKING_DECLINE_REASONS,
  BOOKING_EXPIRE_REASONS,
  BOOKING_REVIEW_REASONS,
  DISPUTE_RESOLUTIONS,
  HANDOFF_PHASES,
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  ITEM_TITLE_MAX_LENGTH,
  LOCALES,
  type BookingCancelReason,
  type BookingDeclineReason,
  type BookingExpireReason,
  type BookingHandoffUnconfirmedV1Payload,
  type BookingReturnedV1Payload,
  type BookingReviewReason,
  type BookingReviewRequestedV1Payload,
  type BookingDisputedV1Payload,
  type DisputeDisagreedV1Payload,
  type DisputeResolution,
  type DisputeResolvedV1Payload,
  type HandoffPhase,
  type BookingSnapshotV1,
  type ConversationUnreadV1Payload,
  type Locale,
  type OfferSentV1Payload,
  type PaymentFailedV1Payload,
  type PaymentRefundedV1Payload,
  type PaymentSettledV1Payload,
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

/** `payment.refunded.v1`. */
export class PaymentRefundedPayload implements PaymentRefundedV1Payload {
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
}

/** `payment.settled.v1`. */
export class PaymentSettledPayload implements PaymentSettledV1Payload {
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
  payoutCents!: number;

  @IsInt()
  @Min(0)
  depositRefundCents!: number;
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

/** `booking.returned.v1`. */
export class ReturnedPayload
  extends BookingPayload
  implements BookingReturnedV1Payload
{
  @ValidateIf((_, value) => value !== null)
  @IsISO8601({ strict: true })
  claimUntil!: string | null;
}

/** `booking.handoff_unconfirmed.v1`. */
export class HandoffUnconfirmedPayload
  extends BookingPayload
  implements BookingHandoffUnconfirmedV1Payload
{
  @IsIn(HANDOFF_PHASES)
  phase!: HandoffPhase;

  @IsInt()
  @Min(1)
  @Max(3)
  round!: 1 | 2 | 3;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsUUID('all', { each: true })
  askUserIds!: string[];

  @IsISO8601({ strict: true })
  decideAt!: string;
}

/** `booking.review_requested.v1`. */
export class ReviewRequestedPayload
  extends BookingPayload
  implements BookingReviewRequestedV1Payload
{
  @IsIn(BOOKING_REVIEW_REASONS)
  reason!: BookingReviewReason;
}

/** `booking.disputed.v1` (the claim's amount since ADR-0028). */
export class DisputedPayload
  extends BookingPayload
  implements BookingDisputedV1Payload
{
  @IsOptional()
  @IsInt()
  @Min(0)
  claimCents?: number;
}

/** `dispute.disagreed.v1`. */
export class DisputeDisagreedPayload
  extends BookingPayload
  implements DisputeDisagreedV1Payload
{
  @IsInt()
  @Min(0)
  claimCents!: number;
}

/** `dispute.resolved.v1`. */
export class DisputeResolvedPayload
  extends BookingPayload
  implements DisputeResolvedV1Payload
{
  @IsInt()
  @Min(0)
  claimCents!: number;

  @IsInt()
  @Min(0)
  awardCents!: number;

  @IsIn(DISPUTE_RESOLUTIONS)
  resolvedBy!: DisputeResolution;
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
