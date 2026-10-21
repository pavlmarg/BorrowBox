import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '@borrowbox/auth';
import {
  CONVERSATIONS_PAGE_DEFAULT,
  createEnvelope,
  MessageSentV1,
  MESSAGES_PAGE_DEFAULT,
  type ConversationView,
  type ListConversationsResponse,
  type ListMessagesResponse,
  type MarkReadResponse,
  type MessageView,
  type MessagingDataExport,
  type UnreadCountResponse,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import { decodeListCursor, encodeListCursor } from '../bookings/list-cursor';
import { findItem } from '../read-models/items.repository';
import { findUser } from '../read-models/users.repository';
import { ChatPublisher, ChatPushes } from './chat-publisher';
import { ChatQueue } from './chat-queue';
import { MessagingError } from './messaging-errors';
import type {
  ListConversationsDto,
  ListMessagesDto,
  ReportMessageDto,
  SendMessageDto,
} from './messaging.dto';
import {
  countAllUnread,
  countUnread,
  ensureConversation,
  findConversation,
  findConversationFor,
  findMessage,
  findOpenOffer,
  insertMessage,
  insertReport,
  lastMessage,
  listAllConversations,
  listConversations,
  listMessages,
  listOffersOf,
  listOwnMessages,
  listReportsBy,
  lockConversation,
  setReadAt,
  type ConversationRow,
  type MessageRow,
} from './messaging.repository';
import {
  roleIn,
  toConversationView,
  toMessageView,
  toOfferView,
} from './views';

const NOT_FOUND = () =>
  new MessagingError('NOT_FOUND', 'Conversation not found');

/**
 * In-app chat (ADR-0017): one conversation per item and asker, free text
 * before and during bookings, contact details masked until a booking goes
 * ahead. Someone else's conversation answers NOT_FOUND.
 */
@Injectable()
export class MessagingService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly chat: ChatPublisher,
    private readonly queue: ChatQueue,
  ) {}

  /**
   * The caller's conversation about the item, started if new. Needs a
   * verified email and an `ACTIVE` item that isn't the caller's.
   */
  async start(user: AuthUser, itemId: string): Promise<ConversationView> {
    const tx = this.dataSource.manager;
    const existing = await findConversationFor(tx, itemId, user.userId);
    if (existing) return this.view(tx, existing, user.userId);

    const me = await findUser(tx, user.userId);
    if (me?.deleted_at) throw unauthenticated();
    const item = await findItem(tx, itemId);
    if (!item || item.status === 'DRAFT') {
      throw new MessagingError('NOT_FOUND', 'Item not found');
    }
    if (item.lender_id === user.userId) {
      throw new MessagingError(
        'OWN_ITEM',
        "You can't start a conversation about your own item",
      );
    }
    const lender = await findUser(tx, item.lender_id);
    if (item.status !== 'ACTIVE' || lender?.deleted_at) {
      throw new MessagingError(
        'ITEM_UNAVAILABLE',
        "This item isn't available right now",
      );
    }
    if (!me?.email_verified_at) {
      throw new MessagingError(
        'EMAIL_NOT_VERIFIED',
        'Confirm your email address before sending messages',
      );
    }
    const conversation = await ensureConversation(tx, {
      itemId: item.item_id,
      lenderId: item.lender_id,
      renterId: user.userId,
      itemTitle: item.title,
    });
    return this.view(tx, conversation, user.userId);
  }

  async listMine(
    user: AuthUser,
    dto: ListConversationsDto,
  ): Promise<ListConversationsResponse> {
    const after = this.cursor(dto.cursor);
    const limit = dto.limit ?? CONVERSATIONS_PAGE_DEFAULT;
    const tx = this.dataSource.manager;
    const rows = await listConversations(tx, {
      userId: user.userId,
      after,
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      conversations: await Promise.all(
        page.map((c) => this.view(tx, c, user.userId)),
      ),
      nextCursor:
        rows.length > limit && last
          ? encodeListCursor({ createdAt: last.last_message_at, id: last.id })
          : null,
    };
  }

  async get(user: AuthUser, conversationId: string): Promise<ConversationView> {
    const tx = this.dataSource.manager;
    return this.view(
      tx,
      await this.mustFind(tx, conversationId, user),
      user.userId,
    );
  }

  async messages(
    user: AuthUser,
    dto: ListMessagesDto,
  ): Promise<ListMessagesResponse> {
    const tx = this.dataSource.manager;
    const c = await this.mustFind(tx, dto.conversationId, user);
    const before = this.cursor(dto.cursor);
    const limit = dto.limit ?? MESSAGES_PAGE_DEFAULT;
    const rows = await listMessages(tx, {
      conversationId: c.id,
      before,
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      messages: page.map((m) => toMessageView(m, user.userId, c.unlocked)),
      nextCursor:
        rows.length > limit && last
          ? encodeListCursor({ createdAt: last.created_at, id: last.id })
          : null,
    };
  }

  /**
   * Sends a text message. The client picks its id, so a retried send
   * returns the same message. Sending also marks the conversation read for
   * the sender.
   */
  async send(
    user: AuthUser,
    dto: SendMessageDto,
    correlationId: string,
  ): Promise<MessageView> {
    const pushes = new ChatPushes();
    const result = await this.dataSource.transaction(async (tx) => {
      await this.assertActive(tx, user);
      const c = await this.mustLock(tx, dto.conversationId, user);
      const existing = await findMessage(tx, dto.messageId);
      if (existing) {
        if (
          existing.sender_id === user.userId &&
          existing.conversation_id === c.id
        ) {
          return { c, message: existing, fresh: false };
        }
        throw new MessagingError(
          'VALIDATION_FAILED',
          'Invalid fields: messageId',
        );
      }
      if (c.closed) throw closed();

      await insertMessage(tx, {
        id: dto.messageId,
        conversationId: c.id,
        kind: 'TEXT',
        senderId: user.userId,
        body: dto.text,
      });
      const message = (await findMessage(tx, dto.messageId)) as MessageRow;
      await setReadAt(tx, c.id, roleIn(c, user.userId), message.created_at);
      const recipientId = otherOf(c, user.userId);
      await addToOutbox(
        tx,
        createEnvelope(
          MessageSentV1,
          {
            messageId: message.id,
            conversationId: c.id,
            itemId: c.item_id,
            senderId: user.userId,
            recipientId,
            sentAt: message.created_at.toISOString(),
          },
          { correlationId },
        ),
      );
      pushes.message(message.id);
      return { c, message, fresh: true };
    });
    if (result.fresh) {
      await this.chat.flush(pushes);
      await this.queue.remindLater(result.message.id);
    }
    return toMessageView(result.message, user.userId, result.c.unlocked);
  }

  async markRead(
    user: AuthUser,
    conversationId: string,
  ): Promise<MarkReadResponse> {
    const tx = this.dataSource.manager;
    const c = await this.mustFind(tx, conversationId, user);
    const readAt = new Date();
    await setReadAt(tx, c.id, roleIn(c, user.userId), readAt);
    const pushes = new ChatPushes();
    pushes.read(c.id, user.userId, readAt);
    await this.chat.flush(pushes);
    return { readAt: readAt.toISOString() };
  }

  async unreadCount(user: AuthUser): Promise<UnreadCountResponse> {
    return {
      total: await countAllUnread(this.dataSource.manager, user.userId),
    };
  }

  /** Reporting someone else's message; the report waits for the admin area. */
  async report(user: AuthUser, dto: ReportMessageDto): Promise<void> {
    const tx = this.dataSource.manager;
    await this.assertActive(tx, user);
    const message = await findMessage(tx, dto.messageId);
    const c = message && (await findConversation(tx, message.conversation_id));
    if (!message || !c || !isParty(c, user.userId)) {
      throw new MessagingError('NOT_FOUND', 'Message not found');
    }
    if (message.sender_id === null || message.sender_id === user.userId) {
      throw new MessagingError(
        'INVALID_STATE',
        'Only messages from the other person can be reported',
      );
    }
    await insertReport(tx, message.id, user.userId, dto.reason);
  }

  /** Everything Messaging holds about the caller (GDPR Art. 15/20). */
  async exportMe(user: AuthUser): Promise<MessagingDataExport> {
    const tx = this.dataSource.manager;
    const conversations = await listAllConversations(tx, user.userId);
    return {
      exportedAt: new Date().toISOString(),
      conversations: await Promise.all(
        conversations.map(async (c) => ({
          id: c.id,
          itemId: c.item_id,
          itemTitle: c.item_title,
          role: roleIn(c, user.userId),
          createdAt: c.created_at.toISOString(),
          myMessages: (await listOwnMessages(tx, c.id, user.userId)).map(
            (m) => ({
              id: m.id,
              text: m.body,
              sentAt: m.created_at.toISOString(),
            }),
          ),
        })),
      ),
      offers: (await listOffersOf(tx, user.userId)).map((o) => toOfferView(o)),
      reports: (await listReportsBy(tx, user.userId)).map((r) => ({
        messageId: r.message_id,
        reason: r.reason,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }

  // --- helpers ----------------------------------------------------------------

  private async view(
    tx: EntityManager,
    c: ConversationRow,
    userId: string,
  ): Promise<ConversationView> {
    const readAt =
      roleIn(c, userId) === 'RENTER' ? c.renter_read_at : c.lender_read_at;
    return toConversationView(c, userId, {
      lastMessage: await lastMessage(tx, c.id),
      unreadCount: await countUnread(tx, c.id, userId, readAt),
      openOffer: await findOpenOffer(tx, c.id),
    });
  }

  private cursor(value: string | undefined) {
    if (!value) return null;
    const decoded = decodeListCursor(value);
    if (!decoded) {
      throw new MessagingError('VALIDATION_FAILED', 'Invalid fields: cursor');
    }
    return { at: decoded.createdAt, id: decoded.id };
  }

  private async assertActive(tx: EntityManager, user: AuthUser): Promise<void> {
    if ((await findUser(tx, user.userId))?.deleted_at) throw unauthenticated();
  }

  private async mustFind(
    tx: EntityManager,
    id: string,
    user: AuthUser,
  ): Promise<ConversationRow> {
    const c = await findConversation(tx, id);
    if (!c || !isParty(c, user.userId)) throw NOT_FOUND();
    return c;
  }

  private async mustLock(
    tx: EntityManager,
    id: string,
    user: AuthUser,
  ): Promise<ConversationRow> {
    const c = await lockConversation(tx, id);
    if (!c || !isParty(c, user.userId)) throw NOT_FOUND();
    return c;
  }
}

export function isParty(c: ConversationRow, userId: string): boolean {
  return c.renter_id === userId || c.lender_id === userId;
}

export function otherOf(c: ConversationRow, userId: string): string {
  return c.renter_id === userId ? c.lender_id : c.renter_id;
}

function closed(): MessagingError {
  return new MessagingError(
    'CONVERSATION_CLOSED',
    'This conversation is closed',
  );
}

function unauthenticated(): MessagingError {
  return new MessagingError('UNAUTHENTICATED', 'Authentication required');
}
