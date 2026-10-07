import { Controller, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CurrentUser, RpcJwtAuthGuard, type AuthUser } from '@borrowbox/auth';
import { CatalogRpc, type OwnItem } from '@borrowbox/contracts';
import { CorrelationIdPipe } from '../rpc/correlation-id.pipe';
import {
  CreateItemDto,
  ItemRefDto,
  SetItemLocationDto,
  UpdateItemDto,
} from './items.dto';
import { ItemsService } from './items.service';

/**
 * The caller's own items. The caller is identified by the re-verified access
 * token only, never by ids in `data`; ownership is checked in ItemsService.
 */
@Controller()
@UseGuards(RpcJwtAuthGuard)
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @MessagePattern(CatalogRpc.create)
  create(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: CreateItemDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<OwnItem> {
    return this.items.create(user, dto, correlationId);
  }

  @MessagePattern(CatalogRpc.update)
  update(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: UpdateItemDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<OwnItem> {
    return this.items.update(user, dto, correlationId);
  }

  @MessagePattern(CatalogRpc.setLocation)
  setLocation(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: SetItemLocationDto,
  ): Promise<OwnItem> {
    return this.items.setLocation(user, dto.itemId, dto.location);
  }

  @MessagePattern(CatalogRpc.publish)
  publish(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ItemRefDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<OwnItem> {
    return this.items.publish(user, dto.itemId, correlationId);
  }

  @MessagePattern(CatalogRpc.pause)
  pause(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ItemRefDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<OwnItem> {
    return this.items.pause(user, dto.itemId, correlationId);
  }

  @MessagePattern(CatalogRpc.unpause)
  unpause(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ItemRefDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<OwnItem> {
    return this.items.unpause(user, dto.itemId, correlationId);
  }

  @MessagePattern(CatalogRpc.delete)
  delete(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ItemRefDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<void> {
    return this.items.delete(user, dto.itemId, correlationId);
  }

  @MessagePattern(CatalogRpc.getOwn)
  getOwn(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ItemRefDto,
  ): Promise<OwnItem> {
    return this.items.getOwn(user, dto.itemId);
  }

  @MessagePattern(CatalogRpc.listMine)
  listMine(@CurrentUser() user: AuthUser): Promise<OwnItem[]> {
    return this.items.listMine(user);
  }
}
