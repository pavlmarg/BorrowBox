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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@borrowbox/auth';
import { MessagingRpc } from '@borrowbox/contracts';
import { ApiErrorResponse } from '../api.dto';
import { BookingViewResponse } from '../bookings/bookings.api';
import { MessagingClient } from '../bookings/bookings.client';
import {
  BookingRequestRateLimit,
  MessageRateLimit,
  NewConversationRateLimit,
} from '../http/rate-limits';
import { AccessToken, CorrelationId } from '../http/request-context';
import {
  BookOfferBody,
  ConversationViewResponse,
  ListConversationsResponse,
  ListMessagesResponse,
  MarkReadResponse,
  MessagesPageQuery,
  MessageViewResponse,
  OfferViewResponse,
  PageQuery,
  ReportMessageBody,
  SendMessageBody,
  SendOfferBody,
  UnreadCountResponse,
} from './messaging.api';

const uuid = (name: string) => Param(name, ParseUUIDPipe);

/**
 * In-app chat and price offers (ADR-0017, ADR-0018). Sending happens here;
 * new messages also arrive live over Socket.IO (`/chat`). Messaging checks
 * the caller's side of each conversation (someone else's is NOT_FOUND).
 */
@ApiTags('messages')
@ApiBearerAuth()
@ApiResponse({
  status: 400,
  type: ApiErrorResponse,
  description: 'VALIDATION_FAILED',
})
@ApiResponse({
  status: 401,
  type: ApiErrorResponse,
  description: 'UNAUTHENTICATED',
})
@ApiResponse({ status: 404, type: ApiErrorResponse, description: 'NOT_FOUND' })
@UseGuards(JwtAuthGuard)
@Controller()
export class ConversationsController {
  constructor(private readonly messaging: MessagingClient) {}

  @Post('items/:itemId/conversations')
  @HttpCode(HttpStatus.OK)
  @NewConversationRateLimit()
  @ApiOperation({
    summary: 'My conversation about an item, started if new',
    description:
      'Needs a verified email and a published item that is not mine. The lender replies but cannot start one.',
  })
  @ApiOkResponse({ type: ConversationViewResponse })
  @ApiResponse({
    status: 403,
    type: ApiErrorResponse,
    description: 'EMAIL_NOT_VERIFIED',
  })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'OWN_ITEM, ITEM_UNAVAILABLE',
  })
  @ApiResponse({
    status: 429,
    type: ApiErrorResponse,
    description: 'RATE_LIMITED (20 per day)',
  })
  start(
    @uuid('itemId') itemId: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<ConversationViewResponse> {
    return this.messaging.call(
      MessagingRpc.start,
      { itemId },
      { accessToken, correlationId },
    );
  }

  @Get('me/conversations')
  @ApiOperation({ summary: 'My conversations, most recent activity first' })
  @ApiOkResponse({ type: ListConversationsResponse })
  list(
    @Query() query: PageQuery,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<ListConversationsResponse> {
    return this.messaging.call(MessagingRpc.listMine, query, {
      accessToken,
      correlationId,
    });
  }

  @Get('me/unread')
  @ApiOperation({ summary: 'Unread messages across my conversations' })
  @ApiOkResponse({ type: UnreadCountResponse })
  unread(
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<UnreadCountResponse> {
    return this.messaging.call(
      MessagingRpc.unreadCount,
      {},
      { accessToken, correlationId },
    );
  }

  @Get('conversations/:conversationId')
  @ApiOperation({ summary: 'One of my conversations' })
  @ApiOkResponse({ type: ConversationViewResponse })
  get(
    @uuid('conversationId') conversationId: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<ConversationViewResponse> {
    return this.messaging.call(
      MessagingRpc.get,
      { conversationId },
      { accessToken, correlationId },
    );
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'Messages, newest first, page by page' })
  @ApiOkResponse({ type: ListMessagesResponse })
  messages(
    @uuid('conversationId') conversationId: string,
    @Query() query: MessagesPageQuery,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<ListMessagesResponse> {
    return this.messaging.call(
      MessagingRpc.messages,
      { ...query, conversationId },
      { accessToken, correlationId },
    );
  }

  @Post('conversations/:conversationId/messages')
  @MessageRateLimit()
  @ApiOperation({
    summary: 'Send a message',
    description:
      'The client picks the id; repeating it returns the same message.',
  })
  @ApiCreatedResponse({ type: MessageViewResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'CONVERSATION_CLOSED',
  })
  @ApiResponse({
    status: 429,
    type: ApiErrorResponse,
    description: 'RATE_LIMITED (30 per minute)',
  })
  send(
    @uuid('conversationId') conversationId: string,
    @Body() body: SendMessageBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<MessageViewResponse> {
    return this.messaging.call(
      MessagingRpc.send,
      { ...body, conversationId },
      { accessToken, correlationId },
    );
  }

  @Post('conversations/:conversationId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark the conversation read up to now' })
  @ApiOkResponse({ type: MarkReadResponse })
  read(
    @uuid('conversationId') conversationId: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<MarkReadResponse> {
    return this.messaging.call(
      MessagingRpc.markRead,
      { conversationId },
      { accessToken, correlationId },
    );
  }

  @Post('messages/:messageId/report')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Report the other person's message" })
  @ApiNoContentResponse()
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'INVALID_STATE (own message or a system line)',
  })
  async report(
    @uuid('messageId') messageId: string,
    @Body() body: ReportMessageBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<void> {
    await this.messaging.call(
      MessagingRpc.report,
      { messageId, reason: body.reason },
      { accessToken, correlationId },
    );
  }

  @Post('conversations/:conversationId/offers')
  @MessageRateLimit()
  @ApiOperation({
    summary: 'Offer a price for a period (lender)',
    description:
      'At most the rate card’s rent; the deposit is the item’s. Replaces the open offer; valid 48 hours or until an hour before the start.',
  })
  @ApiCreatedResponse({ type: OfferViewResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description:
      'INVALID_STATE, CONVERSATION_CLOSED, ITEM_UNAVAILABLE, PRICE_ABOVE_LIST',
  })
  sendOffer(
    @uuid('conversationId') conversationId: string,
    @Body() body: SendOfferBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<OfferViewResponse> {
    return this.messaging.call(
      MessagingRpc.sendOffer,
      { ...body, conversationId },
      { accessToken, correlationId },
    );
  }

  @Post('offers/:offerId/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw an open offer (lender)' })
  @ApiOkResponse({ type: OfferViewResponse })
  @ApiResponse({
    status: 409,
    type: ApiErrorResponse,
    description: 'INVALID_STATE, OFFER_UNAVAILABLE',
  })
  withdrawOffer(
    @uuid('offerId') offerId: string,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<OfferViewResponse> {
    return this.messaging.call(
      MessagingRpc.withdrawOffer,
      { offerId },
      { accessToken, correlationId },
    );
  }

  @Post('offers/:offerId/book')
  @BookingRequestRateLimit()
  @ApiOperation({
    summary: 'Book an offer (renter)',
    description:
      'Accepted at once, at the offer’s price. The client picks the booking id; repeating it returns the same booking.',
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
      'INVALID_STATE, OFFER_UNAVAILABLE, ITEM_UNAVAILABLE, SLOT_TAKEN',
  })
  bookOffer(
    @uuid('offerId') offerId: string,
    @Body() body: BookOfferBody,
    @AccessToken() accessToken: string,
    @CorrelationId() correlationId: string,
  ): Promise<BookingViewResponse> {
    return this.messaging.call(
      MessagingRpc.bookOffer,
      { offerId, bookingId: body.bookingId },
      { accessToken, correlationId },
    );
  }
}
