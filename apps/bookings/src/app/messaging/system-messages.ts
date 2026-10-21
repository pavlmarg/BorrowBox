import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { SystemMessageCode } from '@borrowbox/contracts';
import type { BookingRow } from '../bookings/bookings.repository';
import type { ChatPushes } from './chat-publisher';
import { ensureConversation, insertMessage } from './messaging.repository';

/**
 * Marks a booking moment in the item's conversation with its renter
 * (ADR-0017), creating the conversation if they never chatted. In the
 * caller's transaction; pushed live after the commit if `pushes` is given.
 */
export async function addBookingLine(
  tx: EntityManager,
  booking: Pick<
    BookingRow,
    'id' | 'item_id' | 'lender_id' | 'renter_id' | 'item_title'
  >,
  code: SystemMessageCode,
  pushes: ChatPushes | null,
): Promise<void> {
  const conversation = await ensureConversation(tx, {
    itemId: booking.item_id,
    lenderId: booking.lender_id,
    renterId: booking.renter_id,
    itemTitle: booking.item_title,
  });
  const id = randomUUID();
  await insertMessage(tx, {
    id,
    conversationId: conversation.id,
    kind: 'SYSTEM',
    senderId: null,
    systemCode: code,
    bookingId: booking.id,
  });
  pushes?.message(id);
}
