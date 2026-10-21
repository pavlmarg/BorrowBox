import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { ConversationUnreadV1, createEnvelope } from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import { DATA_SOURCE } from '@borrowbox/service-kit';
import {
  countUnread,
  deleteStaleConversations,
  findMessage,
  lockConversation,
  setRemindedAt,
} from './messaging.repository';
import { roleIn } from './views';

/** At most one unread-message email per conversation and person per 30 minutes. */
export const REMIND_GAP_MS = 30 * 60 * 1000;
/** Conversations with no message for 2 years are deleted (ADR-0017). */
export const RETENTION_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/**
 * Reminders about unread messages, and retention. Both re-read the rows
 * under a lock, so late or repeated jobs do nothing wrong.
 */
@Injectable()
export class ChatMaintenance {
  private readonly logger = new Logger('ChatMaintenance');

  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  /**
   * Emits `conversation.unread` if the message's recipient still hasn't
   * read it and wasn't reminded about the conversation in the last 30
   * minutes. Notifications emails them a link, never the text.
   *
   * @returns true if a reminder was emitted
   */
  remind(messageId: string, now = new Date()): Promise<boolean> {
    return this.dataSource.transaction(async (tx) => {
      const message = await findMessage(tx, messageId);
      if (!message?.sender_id) return false;
      const c = await lockConversation(tx, message.conversation_id);
      if (!c || c.closed) return false;

      const recipientId =
        c.renter_id === message.sender_id ? c.lender_id : c.renter_id;
      const role = roleIn(c, recipientId);
      const readAt = role === 'RENTER' ? c.renter_read_at : c.lender_read_at;
      const remindedAt =
        role === 'RENTER' ? c.renter_reminded_at : c.lender_reminded_at;
      if (readAt && readAt.getTime() >= message.created_at.getTime()) {
        return false;
      }
      if (remindedAt && now.getTime() - remindedAt.getTime() < REMIND_GAP_MS) {
        return false;
      }

      await setRemindedAt(tx, c.id, role, now);
      await addToOutbox(
        tx,
        createEnvelope(ConversationUnreadV1, {
          conversationId: c.id,
          itemId: c.item_id,
          itemTitle: c.item_title,
          recipientId,
          senderId: message.sender_id,
          unreadCount: await countUnread(tx, c.id, recipientId, readAt),
        }),
      );
      return true;
    });
  }

  /** Deletes conversations idle for 2 years. Never throws. */
  async retention(now = new Date()): Promise<number> {
    try {
      const deleted = await deleteStaleConversations(
        this.dataSource.manager,
        new Date(now.getTime() - RETENTION_MS),
      );
      if (deleted > 0)
        this.logger.log(`Deleted ${deleted} idle conversation(s)`);
      return deleted;
    } catch (err) {
      this.logger.warn(
        `Retention failed: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      return 0;
    }
  }
}
