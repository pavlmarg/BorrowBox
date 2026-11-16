import { Controller, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CurrentUser, RpcJwtAuthGuard, type AuthUser } from '@borrowbox/auth';
import {
  BookingsRpc,
  type ActiveRentalsResponse,
  type BookingView,
  type HandoffTokenResponse,
} from '@borrowbox/contracts';
import { CorrelationIdPipe } from '@borrowbox/service-kit';
import {
  HandoffAnswerDto,
  HandoffScanDto,
  HandoffTokenDto,
} from './handoff.dto';
import { HandoffService } from './handoff.service';

/**
 * Pickups and returns (ARCHITECTURE.md §5, ADR-0026). The caller comes from
 * the re-verified access token only; their role is checked in HandoffService.
 */
@Controller()
@UseGuards(RpcJwtAuthGuard)
export class HandoffController {
  constructor(private readonly handoff: HandoffService) {}

  @MessagePattern(BookingsRpc.handoffToken)
  token(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: HandoffTokenDto,
  ): Promise<HandoffTokenResponse> {
    return this.handoff.token(user, dto);
  }

  @MessagePattern(BookingsRpc.handoffScan)
  scan(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: HandoffScanDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<BookingView> {
    return this.handoff.scan(user, dto, correlationId);
  }

  @MessagePattern(BookingsRpc.handoffAnswer)
  answer(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: HandoffAnswerDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<BookingView> {
    return this.handoff.answer(user, dto, correlationId);
  }

  /** The gateway asks before forwarding an account deletion. */
  @MessagePattern(BookingsRpc.activeRentals)
  activeRentals(@CurrentUser() user: AuthUser): Promise<ActiveRentalsResponse> {
    return this.handoff.activeRentals(user);
  }
}
