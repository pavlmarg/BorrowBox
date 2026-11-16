import { Controller, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CurrentUser, RpcJwtAuthGuard, type AuthUser } from '@borrowbox/auth';
import {
  BookingsRpc,
  type ClaimResponse,
  type ClaimView,
} from '@borrowbox/contracts';
import { CorrelationIdPipe } from '@borrowbox/service-kit';
import { AnswerClaimDto, ClaimRefDto, FileClaimDto } from './claims.dto';
import { ClaimsService } from './claims.service';

/**
 * Damage claims (ADR-0028). The caller comes from the re-verified access
 * token only; their role in the booking is checked in ClaimsService.
 */
@Controller()
@UseGuards(RpcJwtAuthGuard)
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @MessagePattern(BookingsRpc.claimFile)
  file(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: FileClaimDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<ClaimView> {
    return this.claims.file(user, dto, correlationId);
  }

  @MessagePattern(BookingsRpc.claimWithdraw)
  withdraw(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ClaimRefDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<ClaimView> {
    return this.claims.withdraw(user, dto.bookingId, correlationId);
  }

  @MessagePattern(BookingsRpc.claimAnswer)
  answer(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: AnswerClaimDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<ClaimView> {
    return this.claims.answer(user, dto, correlationId);
  }

  @MessagePattern(BookingsRpc.claimGet)
  get(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ClaimRefDto,
  ): Promise<ClaimResponse> {
    return this.claims.get(user, dto.bookingId);
  }
}
