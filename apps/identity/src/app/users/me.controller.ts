import { Controller, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CurrentUser, RpcJwtAuthGuard, type AuthUser } from '@borrowbox/auth';
import {
  IdentityRpc,
  type IdentityDataExport,
  type UserProfile,
} from '@borrowbox/contracts';
import { CorrelationIdPipe } from '../rpc/correlation-id.pipe';
import { DeleteAccountDto, UpdateProfileDto } from './me.dto';
import { MeService } from './me.service';

/** `me.*`: the caller is identified by the re-verified access token only, never by ids in `data`. */
@Controller()
@UseGuards(RpcJwtAuthGuard)
export class MeController {
  constructor(private readonly me: MeService) {}

  @MessagePattern(IdentityRpc.getMe)
  get(@CurrentUser() user: AuthUser): Promise<UserProfile> {
    return this.me.get(user);
  }

  @MessagePattern(IdentityRpc.updateMe)
  update(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: UpdateProfileDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<UserProfile> {
    return this.me.update(user, dto, correlationId);
  }

  @MessagePattern(IdentityRpc.exportMe)
  export(@CurrentUser() user: AuthUser): Promise<IdentityDataExport> {
    return this.me.export(user);
  }

  @MessagePattern(IdentityRpc.deleteMe)
  delete(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: DeleteAccountDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<void> {
    return this.me.delete(user, dto, correlationId);
  }
}
