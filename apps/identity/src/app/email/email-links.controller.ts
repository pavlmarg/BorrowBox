import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { IdentityRpc } from '@borrowbox/contracts';
import { CorrelationIdPipe } from '@borrowbox/service-kit';
import {
  RequestPasswordResetDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './email-links.dto';
import { EmailLinksService } from './email-links.service';

/** Email links, used without signing in: the token is the proof. */
@Controller()
export class EmailLinksController {
  constructor(private readonly links: EmailLinksService) {}

  @MessagePattern(IdentityRpc.verifyEmail)
  verifyEmail(
    @Payload('data') dto: VerifyEmailDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<void> {
    return this.links.verifyEmail(dto, correlationId);
  }

  @MessagePattern(IdentityRpc.requestPasswordReset)
  requestPasswordReset(
    @Payload('data') dto: RequestPasswordResetDto,
  ): Promise<void> {
    return this.links.requestPasswordReset(dto);
  }

  @MessagePattern(IdentityRpc.resetPassword)
  resetPassword(
    @Payload('data') dto: ResetPasswordDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<void> {
    return this.links.resetPassword(dto, correlationId);
  }
}
