import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import {
  TIMESTAMP_OFFSET_MESSAGE,
  TIMESTAMP_OFFSET_PATTERN,
  BOOKING_LIST_LIMIT_MAX,
  BOOKING_STATUSES,
  type BookingRef,
  type BookingStatus,
  type BusyPeriodsRequest,
  type ItemPeriodRequest,
  type ListBookingsRequest,
  type RequestBookingRequest,
} from '@borrowbox/contracts';

export class BookingRefDto implements BookingRef {
  @IsUUID()
  bookingId!: string;
}

/** Whole hours and the rest of the period rules are checked by `checkPeriod`. */
export class ItemPeriodDto implements ItemPeriodRequest {
  @IsUUID()
  itemId!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TIMESTAMP_OFFSET_PATTERN, { message: TIMESTAMP_OFFSET_MESSAGE })
  start!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TIMESTAMP_OFFSET_PATTERN, { message: TIMESTAMP_OFFSET_MESSAGE })
  end!: string;
}

export class RequestBookingDto
  extends ItemPeriodDto
  implements RequestBookingRequest
{
  @IsUUID()
  bookingId!: string;
}

export class BusyPeriodsDto implements BusyPeriodsRequest {
  @IsUUID()
  itemId!: string;
}

export class ListBookingsDto implements ListBookingsRequest {
  @IsIn(['RENTER', 'LENDER'])
  role!: 'RENTER' | 'LENDER';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BOOKING_STATUSES.length)
  @IsIn(BOOKING_STATUSES, { each: true })
  statuses?: BookingStatus[];

  /** Checked in full by `decodeListCursor`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(BOOKING_LIST_LIMIT_MAX)
  limit?: number;
}
