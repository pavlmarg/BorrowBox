import { Controller, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CurrentUser, RpcJwtAuthGuard, type AuthUser } from '@borrowbox/auth';
import {
  BookingsRpc,
  type BookingView,
  type BookingsDataExport,
  type BusyPeriodsResponse,
  type ListBookingsResponse,
  type QuoteResponse,
} from '@borrowbox/contracts';
import { CorrelationIdPipe } from '@borrowbox/service-kit';
import {
  BookingRefDto,
  BusyPeriodsDto,
  ItemPeriodDto,
  ListBookingsDto,
  RequestBookingDto,
} from './bookings.dto';
import { BookingsService } from './bookings.service';

/** Public queries: no token needed, and nothing about people. */
@Controller()
export class PublicBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @MessagePattern(BookingsRpc.quote)
  quote(@Payload('data') dto: ItemPeriodDto): Promise<QuoteResponse> {
    return this.bookings.quote(dto);
  }

  @MessagePattern(BookingsRpc.busyPeriods)
  busyPeriods(
    @Payload('data') dto: BusyPeriodsDto,
  ): Promise<BusyPeriodsResponse> {
    return this.bookings.busyPeriods(dto.itemId);
  }
}

/**
 * The caller's bookings. The caller is identified by the re-verified access
 * token only, never by ids in `data`; their role in each booking is checked
 * in BookingsService.
 */
@Controller()
@UseGuards(RpcJwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @MessagePattern(BookingsRpc.request)
  request(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: RequestBookingDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<BookingView> {
    return this.bookings.request(user, dto, correlationId);
  }

  @MessagePattern(BookingsRpc.accept)
  accept(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: BookingRefDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<BookingView> {
    return this.bookings.accept(user, dto.bookingId, correlationId);
  }

  @MessagePattern(BookingsRpc.decline)
  decline(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: BookingRefDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<BookingView> {
    return this.bookings.decline(user, dto.bookingId, correlationId);
  }

  @MessagePattern(BookingsRpc.cancel)
  cancel(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: BookingRefDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<BookingView> {
    return this.bookings.cancel(user, dto.bookingId, correlationId);
  }

  @MessagePattern(BookingsRpc.get)
  get(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: BookingRefDto,
  ): Promise<BookingView> {
    return this.bookings.get(user, dto.bookingId);
  }

  @MessagePattern(BookingsRpc.listMine)
  listMine(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ListBookingsDto,
  ): Promise<ListBookingsResponse> {
    return this.bookings.listMine(user, dto);
  }

  /** GDPR export: Bookings' part of `GET /me/export`. */
  @MessagePattern(BookingsRpc.exportMe)
  exportMe(@CurrentUser() user: AuthUser): Promise<BookingsDataExport> {
    return this.bookings.exportMe(user);
  }
}
