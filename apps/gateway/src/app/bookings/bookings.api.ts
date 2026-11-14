import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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
  BOOKING_CANCEL_REASONS,
  BOOKING_DECLINE_REASONS,
  BOOKING_EXPIRE_REASONS,
  BOOKING_LIST_LIMIT_MAX,
  BOOKING_STATUSES,
  type BookingCloseReason,
  type BookingStatus,
  type ListBookingsRequest,
  type RequestBookingRequest,
} from '@borrowbox/contracts';
import { ProfilePhotoUrlsResponse } from '../profile-photo.api';
import { ItemPricingBody } from '../items/items.api';

// HTTP DTOs for Bookings: validated here, validated again by Bookings, and
// the source of the OpenAPI spec the PWA client is generated from.

const BOOKING_REASONS = [
  ...new Set([
    ...BOOKING_DECLINE_REASONS,
    ...BOOKING_CANCEL_REASONS,
    ...BOOKING_EXPIRE_REASONS,
  ]),
];

const ISO = { strict: true, strictSeparator: true } as const;

// --- Requests ---------------------------------------------------------------------

export class PeriodQuery {
  @ApiProperty({
    format: 'date-time',
    description: 'On a whole hour, 1 hour to 180 days ahead',
  })
  @IsISO8601(ISO)
  @Matches(TIMESTAMP_OFFSET_PATTERN, { message: TIMESTAMP_OFFSET_MESSAGE })
  start!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'On a whole hour; 1 hour to 90 days after the start',
  })
  @IsISO8601(ISO)
  @Matches(TIMESTAMP_OFFSET_PATTERN, { message: TIMESTAMP_OFFSET_MESSAGE })
  end!: string;
}

export class RequestBookingBody
  extends PeriodQuery
  implements RequestBookingRequest
{
  @ApiProperty({
    format: 'uuid',
    description:
      'A new random UUID per request; repeating it returns the same booking',
  })
  @IsUUID()
  bookingId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;
}

export class ListBookingsQuery implements ListBookingsRequest {
  @ApiProperty({ enum: ['RENTER', 'LENDER'] })
  @IsIn(['RENTER', 'LENDER'])
  role!: 'RENTER' | 'LENDER';

  @ApiPropertyOptional({
    enum: BOOKING_STATUSES,
    enumName: 'BookingStatus',
    isArray: true,
    description: 'Comma-separated; all statuses if omitted',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMaxSize(BOOKING_STATUSES.length)
  @IsIn(BOOKING_STATUSES, { each: true })
  statuses?: BookingStatus[];

  @ApiPropertyOptional({ description: "The previous page's nextCursor" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: BOOKING_LIST_LIMIT_MAX })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BOOKING_LIST_LIMIT_MAX)
  limit?: number;
}

// --- Responses --------------------------------------------------------------------

export class PriceUnitsResponse {
  @ApiProperty() HOUR!: number;
  @ApiProperty() DAY!: number;
  @ApiProperty() WEEK!: number;
  @ApiProperty() MONTH!: number;
}

export class QuoteResponse {
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty({ format: 'date-time' }) start!: string;
  @ApiProperty({ format: 'date-time' }) end!: string;
  @ApiProperty() rentCents!: number;
  @ApiProperty() depositCents!: number;
  @ApiProperty({ description: "The renter's service fee on top (ADR-0020)" })
  feeCents!: number;
  @ApiProperty({ description: 'What the renter pays: rent + deposit + fee' })
  totalCents!: number;
  @ApiProperty({
    description:
      "Taken from the lender's rent for the deposit's cost (ADR-0020)",
  })
  lenderFeeCents!: number;
  @ApiProperty({
    description: 'What the lender receives once the booking completes',
  })
  payoutCents!: number;
  @ApiProperty({
    type: PriceUnitsResponse,
    description: 'The cheapest combination of the offered units',
  })
  units!: PriceUnitsResponse;
}

export class BookingPriceResponse {
  @ApiProperty() rentCents!: number;
  @ApiProperty() depositCents!: number;
  @ApiProperty({ description: "The renter's service fee on top (ADR-0020)" })
  feeCents!: number;
  @ApiProperty({ description: 'What the renter pays: rent + deposit + fee' })
  totalCents!: number;
  @ApiProperty({
    description:
      "Taken from the lender's rent for the deposit's cost (ADR-0020)",
  })
  lenderFeeCents!: number;
  @ApiProperty({
    description: 'What the lender receives once the booking completes',
  })
  payoutCents!: number;
  @ApiProperty({ type: PriceUnitsResponse }) units!: PriceUnitsResponse;
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description: "Set when the price came from the lender's offer (ADR-0018)",
  })
  offerId!: string | null;
}

export class BookingPeriodResponse {
  @ApiProperty({ format: 'date-time' }) start!: string;
  @ApiProperty({ format: 'date-time' }) end!: string;
}

export class BusyPeriodsResponse {
  @ApiProperty({ type: [BookingPeriodResponse] })
  periods!: BookingPeriodResponse[];
}

export class BookingPartyResponse {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null once the account is deleted',
  })
  displayName!: string | null;
  @ApiProperty({
    type: ProfilePhotoUrlsResponse,
    nullable: true,
    description: 'Public profile photo (ADR-0024); null for none',
  })
  photo!: ProfilePhotoUrlsResponse | null;
}

export class BookingViewResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['RENTER', 'LENDER'], description: "The caller's side" })
  role!: 'RENTER' | 'LENDER';
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() itemTitle!: string;
  @ApiProperty({ type: BookingPartyResponse }) renter!: BookingPartyResponse;
  @ApiProperty({ type: BookingPartyResponse }) lender!: BookingPartyResponse;
  @ApiProperty({ format: 'date-time' }) start!: string;
  @ApiProperty({ format: 'date-time' }) end!: string;
  @ApiProperty({ enum: BOOKING_STATUSES, enumName: 'BookingStatus' })
  status!: BookingStatus;
  @ApiProperty({ type: BookingPriceResponse }) price!: BookingPriceResponse;
  @ApiProperty({
    type: ItemPricingBody,
    description: "The item's rate card when the booking was requested",
  })
  pricing!: ItemPricingBody;
  @ApiProperty({
    enum: BOOKING_REASONS,
    enumName: 'BookingCloseReason',
    nullable: true,
  })
  reason!: BookingCloseReason | null;
  @ApiProperty({
    format: 'date-time',
    nullable: true,
    type: String,
    description: 'While REQUESTED: when it expires without an answer',
  })
  expiresAt!: string | null;
  @ApiProperty({
    format: 'date-time',
    nullable: true,
    type: String,
    description: 'While ACCEPTED: when it expires unless paid (ADR-0019)',
  })
  payBy!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class ListBookingsResponse {
  @ApiProperty({ type: [BookingViewResponse] })
  bookings!: BookingViewResponse[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class BookingsProfileResponse {
  @ApiProperty() displayName!: string;
  @ApiProperty({
    type: ProfilePhotoUrlsResponse,
    nullable: true,
    description: 'Public profile photo (ADR-0024); null for none',
  })
  photo!: ProfilePhotoUrlsResponse | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class BookingsDataExportResponse {
  @ApiProperty({ format: 'date-time' }) exportedAt!: string;
  @ApiProperty({ type: BookingsProfileResponse, nullable: true })
  profile!: BookingsProfileResponse | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  emailVerifiedAt!: string | null;
  @ApiProperty({ type: [BookingViewResponse] })
  asRenter!: BookingViewResponse[];
  @ApiProperty({ type: [BookingViewResponse] })
  asLender!: BookingViewResponse[];
}
