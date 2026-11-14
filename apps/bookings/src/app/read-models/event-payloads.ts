import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  BOOKING_MAX_HOURS,
  BOOKING_MIN_HOURS,
  DEPOSIT_MAX_CENTS,
  DEPOSIT_MIN_CENTS,
  DISPLAY_NAME_MAX_LENGTH,
  ITEM_STATUSES,
  ITEM_TITLE_MAX_LENGTH,
  isValidPricing,
  type EventEnvelope,
  type ItemPricing,
  type ItemStatus,
  type ProfilePhotoUrls,
} from '@borrowbox/contracts';
import { InvalidEventError, parsePayload } from '@borrowbox/service-kit';
import type { ItemSnapshot } from './items.repository';

/**
 * Identity's and Catalog's events as Bookings reads them, checked at runtime
 * with `parsePayload`: only the fields Bookings keeps.
 */

const HTTP_URL = /^https?:\/\/\S+$/;

/** A profile photo's addresses (ADR-0024), as Identity publishes them. */
export class ProfilePhotoPayload implements ProfilePhotoUrls {
  @Matches(HTTP_URL)
  @MaxLength(2048)
  small!: string;

  @Matches(HTTP_URL)
  @MaxLength(2048)
  large!: string;
}

/** `user.registered.v1` and `user.profile_updated.v1`. */
export class UserNamePayload {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(DISPLAY_NAME_MAX_LENGTH)
  displayName!: string;

  /**
   * `user.profile_updated` only: null for none; absent (`user.registered`,
   * older events) means "unknown, keep what we have".
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ProfilePhotoPayload)
  photo?: ProfilePhotoPayload | null;
}

/** `user.email_verified.v1` and `user.deletion_requested.v1`. */
export class UserIdPayload {
  @IsUUID()
  userId!: string;
}

class PricingPayload implements ItemPricing {
  @IsBoolean()
  free!: boolean;

  @IsOptional()
  @IsInt()
  hourlyCents?: number;

  @IsOptional()
  @IsInt()
  dailyCents?: number;

  @IsOptional()
  @IsInt()
  weeklyCents?: number;

  @IsOptional()
  @IsInt()
  monthlyCents?: number;
}

/** `item.created.v1` and `item.updated.v1`. */
export class ItemSnapshotPayload implements ItemSnapshot {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  lenderId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(ITEM_TITLE_MAX_LENGTH)
  title!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PricingPayload)
  pricing!: PricingPayload;

  @IsInt()
  @Min(DEPOSIT_MIN_CENTS)
  @Max(DEPOSIT_MAX_CENTS)
  depositCents!: number;

  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(BOOKING_MIN_HOURS)
  @Max(BOOKING_MAX_HOURS)
  minRentalHours!: number | null;

  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(BOOKING_MIN_HOURS)
  @Max(BOOKING_MAX_HOURS)
  maxRentalHours!: number | null;

  @IsIn(ITEM_STATUSES)
  status!: ItemStatus;
}

/** `item.deleted.v1`. */
export class ItemDeletedPayload {
  @IsUUID()
  itemId!: string;

  @IsUUID()
  lenderId!: string;
}

/**
 * An item snapshot, with the rate card checked as a whole (free with no
 * rates, or rates in range) and copied field by field, so nothing extra
 * from the event is stored.
 */
export function parseItemSnapshot(envelope: EventEnvelope): ItemSnapshot {
  const item = parsePayload(envelope, ItemSnapshotPayload);
  const pricing: ItemPricing = { free: item.pricing.free };
  for (const field of [
    'hourlyCents',
    'dailyCents',
    'weeklyCents',
    'monthlyCents',
  ] as const) {
    if (item.pricing[field] !== undefined) pricing[field] = item.pricing[field];
  }
  if (!isValidPricing(pricing)) {
    throw new InvalidEventError(envelope.type, ['payload.pricing']);
  }
  return {
    itemId: item.itemId,
    lenderId: item.lenderId,
    title: item.title,
    pricing,
    depositCents: item.depositCents,
    minRentalHours: item.minRentalHours ?? null,
    maxRentalHours: item.maxRentalHours ?? null,
    status: item.status,
  };
}
