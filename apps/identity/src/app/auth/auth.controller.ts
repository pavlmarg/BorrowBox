import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { IdentityRpc, type AuthSession } from '@borrowbox/contracts';
import { CorrelationIdPipe } from '../rpc/correlation-id.pipe';
import { LoginDto, LogoutDto, RefreshDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';

/** Gateway → Identity auth calls. Messages are `RpcRequest<T>`; `data` is validated by the global pipe. */
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @MessagePattern(IdentityRpc.register)
  register(
    @Payload('data') dto: RegisterDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<AuthSession> {
    return this.auth.register(dto, correlationId);
  }

  @MessagePattern(IdentityRpc.login)
  login(@Payload('data') dto: LoginDto): Promise<AuthSession> {
    return this.auth.login(dto);
  }

  @MessagePattern(IdentityRpc.refresh)
  refresh(@Payload('data') dto: RefreshDto): Promise<AuthSession> {
    return this.auth.refresh(dto);
  }

  @MessagePattern(IdentityRpc.logout)
  logout(@Payload('data') dto: LogoutDto): Promise<void> {
    return this.auth.logout(dto);
  }
}
