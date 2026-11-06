import { Controller, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CurrentUser, RpcJwtAuthGuard, type AuthUser } from '@borrowbox/auth';
import {
  MessagingRpc,
  type BookingView,
  type ConversationView,
  type ListConversationsResponse,
  type ListMessagesResponse,
  type MarkReadResponse,
  type MessageView,
  type MessagingDataExport,
  type OfferView,
  type UnreadCountResponse,
} from '@borrowbox/contracts';
import { CorrelationIdPipe } from '@borrowbox/service-kit';
import {
  BookOfferDto,
  ConversationRefDto,
  ListConversationsDto,
  ListMessagesDto,
  OfferRefDto,
  ReportMessageDto,
  SendMessageDto,
  SendOfferDto,
  StartConversationDto,
} from './messaging.dto';
import { MessagingService } from './messaging.service';
import { OffersService } from './offers.service';

/**
 * The caller's conversations, messages and offers (ADR-0017, ADR-0018). The
 * caller is identified by the re-verified access token only; their side of
 * each conversation is checked in the services.
 */
@Controller()
@UseGuards(RpcJwtAuthGuard)
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly offers: OffersService,
  ) {}

  @MessagePattern(MessagingRpc.start)
  start(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: StartConversationDto,
  ): Promise<ConversationView> {
    return this.messaging.start(user, dto.itemId);
  }

  @MessagePattern(MessagingRpc.listMine)
  listMine(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ListConversationsDto,
  ): Promise<ListConversationsResponse> {
    return this.messaging.listMine(user, dto);
  }

  @MessagePattern(MessagingRpc.get)
  get(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ConversationRefDto,
  ): Promise<ConversationView> {
    return this.messaging.get(user, dto.conversationId);
  }

  @MessagePattern(MessagingRpc.messages)
  messages(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ListMessagesDto,
  ): Promise<ListMessagesResponse> {
    return this.messaging.messages(user, dto);
  }

  @MessagePattern(MessagingRpc.send)
  send(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: SendMessageDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<MessageView> {
    return this.messaging.send(user, dto, correlationId);
  }

  @MessagePattern(MessagingRpc.markRead)
  markRead(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ConversationRefDto,
  ): Promise<MarkReadResponse> {
    return this.messaging.markRead(user, dto.conversationId);
  }

  @MessagePattern(MessagingRpc.unreadCount)
  unreadCount(@CurrentUser() user: AuthUser): Promise<UnreadCountResponse> {
    return this.messaging.unreadCount(user);
  }

  @MessagePattern(MessagingRpc.report)
  report(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: ReportMessageDto,
  ): Promise<void> {
    return this.messaging.report(user, dto);
  }

  @MessagePattern(MessagingRpc.sendOffer)
  sendOffer(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: SendOfferDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<OfferView> {
    return this.offers.send(user, dto, correlationId);
  }

  @MessagePattern(MessagingRpc.withdrawOffer)
  withdrawOffer(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: OfferRefDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<OfferView> {
    return this.offers.withdraw(user, dto.offerId, correlationId);
  }

  @MessagePattern(MessagingRpc.bookOffer)
  bookOffer(
    @CurrentUser() user: AuthUser,
    @Payload('data') dto: BookOfferDto,
    @Payload('correlationId', CorrelationIdPipe) correlationId: string,
  ): Promise<BookingView> {
    return this.offers.book(user, dto, correlationId);
  }

  /** GDPR export: Messaging's part of `GET /me/export`. */
  @MessagePattern(MessagingRpc.exportMe)
  exportMe(@CurrentUser() user: AuthUser): Promise<MessagingDataExport> {
    return this.messaging.exportMe(user);
  }
}
