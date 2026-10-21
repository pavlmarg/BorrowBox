import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@borrowbox/auth';
import { BookingsRpc } from '@borrowbox/contracts';
import { ApiErrorResponse } from '../api.dto';
import { BookingRequestRateLimit } from '../http/rate-limits';
import { AccessToken, CorrelationId } from '../http/request-context';
import {
  BookingViewResponse,
  BusyPeriodsResponse,
  ListBookingsQuery,
  ListBookingsResponse,
  PeriodQuery,
  QuoteResponse,
  RequestBookingBody,
} from './bookings.api';
import { BookingsClient } from './bookings.client';

const itemId = () => Param('itemId', ParseUUIDPipe);
const bookingId = () => Param('bookingId', ParseUUIDPipe);

/** Public booking queries on an item page: no sign-in, nothing about people. */
@ApiTags('bookings')
@ApiResponse({
  status: 400,
  type: ApiErrorResponse,
  description: 'VALIDATION_FAILED, INVALID_PERIOD',
})
@ApiResponse({
  status: 404,
  type: ApiErrorResponse,
  description: 'NOT_FOUND (unknown or not bookable)',
})
@Controller('items')
export class ItemBookingsController {
  constructor(private readonly bookings: BookingsClient) {}

  @Get(':itemId/quote')
  @ApiOperation({
    summary: 'What a period would cost (the cheapest combination of rates)',
  })
  @ApiOkResponse({ type: QuoteResponse })
  quote(
    @itemId() id: string,
    @Query() query: PeriodQuery,
    @CorrelationId() correlationId: string,
  ): Promise<QuoteResponse> {
    return this.bookings.call(
      BookingsRpc.quote,
      { itemId: id, start: query.start, end: query.end },
      { correlationId },
    );
  }

  @Get(':itemId/busy')
  @ApiOperation({
    summary: 'When the item is taken from now on (periods only)',
  })
  @ApiOkResponse({ type: BusyPeriodsResponse })
  busy(
    @itemId() id: string,
    @CorrelationId() correlationId: string,
  ): Promise<BusyPeriodsResponse> {
    return this.bookings.call(
      BookingsRpc.busyPeriods,
      { itemId: id },
      { correlationId },
    );
  }
}

/**
 * The signed-in user's bookings (ADR-0015). The gateway checks the JWT;
 * Bookings checks it again and checks the caller's side of each booking
 * (someone else's booking is always NOT_FOUND).
 */
@ApiTags('bookings')
@ApiBearerAuth()
@ApiResponse({
  status: 400,
  type: ApiErrorResponse,
  description: 'VALIDATION_FAILED, INVALID_PERIOD',
})
@ApiResponse({
  status: 401,
  type: ApiErrorResponse,
  description: 'UNAUTHENTICATED',
})
@ApiResponse({ status: 404, type: ApiErrorResponse, description: 'NOT_FOUND' })
@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsClient) {}

  @Post()
  @BookingRequestRateLimit()
  @ApiOperation({
    summary: 'Ask to book an item for a period',
    description:
      'The client picks the id; repeating the same request returns the same booking. The price is fixed now.',
  })
  @ApiCreatedResponse({ type: BookingViewResponse })
  @ApiResponse({
    status: 403,
    type: ApiErrorResponse,
    description: 'EMAIL_NOT_VERIFIED',
  })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description:
      'ITEM_UNAVAILABLE, OWN_ITEM, SLOT_TAKEN, DUPLICATE_REQUEST, REQUEST_LIMIT_REACHED',
  })
  @ApiResponse({
    status: 429,
    type: ApiErrorResponse,
    description: 'RATE_LIMITED (30 per hour)',
  })
  request(
    @Body() body: RequestBookingBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<BookingViewResponse> {
    return this.bookings.call(BookingsRpc.request, body, {
      accessToken,
      correlationId,
    });
  }

  @Get(':bookingId')
  @ApiOperation({ summary: 'One of my bookings, as renter or lender' })
  @ApiOkResponse({ type: BookingViewResponse })
  get(
    @bookingId() id: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<BookingViewResponse> {
    return this.bookings.call(
      BookingsRpc.get,
      { bookingId: id },
      { accessToken, correlationId },
    );
  }

  @Post(':bookingId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept a request (lender)',
    description:
      'CONFIRMED when there is nothing to pay, else ACCEPTED. Declines the other requests that overlap it.',
  })
  @ApiOkResponse({ type: BookingViewResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'INVALID_STATE, SLOT_TAKEN',
  })
  accept(
    @bookingId() id: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<BookingViewResponse> {
    return this.bookings.call(
      BookingsRpc.accept,
      { bookingId: id },
      { accessToken, correlationId },
    );
  }

  @Post(':bookingId/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline a request (lender)' })
  @ApiOkResponse({ type: BookingViewResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'INVALID_STATE',
  })
  decline(
    @bookingId() id: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<BookingViewResponse> {
    return this.bookings.call(
      BookingsRpc.decline,
      { bookingId: id },
      { accessToken, correlationId },
    );
  }

  @Post(':bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Withdraw a request (renter), or cancel before the start',
  })
  @ApiOkResponse({ type: BookingViewResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'INVALID_STATE',
  })
  cancel(
    @bookingId() id: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<BookingViewResponse> {
    return this.bookings.call(
      BookingsRpc.cancel,
      { bookingId: id },
      { accessToken, correlationId },
    );
  }
}

/** The renter and lender tabs of "my bookings". */
@ApiTags('bookings')
@ApiBearerAuth()
@ApiResponse({
  status: 401,
  type: ApiErrorResponse,
  description: 'UNAUTHENTICATED',
})
@UseGuards(JwtAuthGuard)
@Controller('me/bookings')
export class MyBookingsController {
  constructor(private readonly bookings: BookingsClient) {}

  @Get()
  @ApiOperation({ summary: 'My bookings in one role, newest first' })
  @ApiOkResponse({ type: ListBookingsResponse })
  list(
    @Query() query: ListBookingsQuery,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<ListBookingsResponse> {
    return this.bookings.call(BookingsRpc.listMine, query, {
      accessToken,
      correlationId,
    });
  }
}
