import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { IdentityRpc, type AuthSession } from '@borrowbox/contracts';
import { CorrelationIdPipe } from '../rpc/correlation-id.pipe';
import { GoogleAuthService } from './google-auth.service';
import { GoogleExchangeDto } from './google.dto';

@Controller()
export class GoogleController {
  constructor(private readonly google: GoogleAuthService) {}

  @MessagePattern(IdentityRpc.googleExchange)
  exchange(
    @Payload('data') dto: GoogleExchangeDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<AuthSession> {
    return this.google.signIn(dto, correlationId);
  }
}
