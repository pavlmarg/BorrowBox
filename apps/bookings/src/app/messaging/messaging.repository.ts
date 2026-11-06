import type { EntityManager } from 'typeorm';
import type {
  MessageKind,
  OfferStatus,
  ReportReason,
  SystemMessageCode,
} from '@borrowbox/contracts';

/**
 * Conversations, messages, offers and reports (ADR-0017, ADR-0018). Fixed
 * SQL only: values always go in as $n parameters.
 */

/** Statuses of a booking that went ahead: contact details are shown unmasked. */
const UNLOCKING = [
  'CONFIRMED',
  'PAID',
  'PICKED_UP',
  'RETURNED',
  'COMPLETED',
  'DISPUTED',
];

export interface ConversationRow {
  id: string;
  item_id: string;
  lender_id: string;
  renter_id: string;
  item_title: string;
  created_at: Date;
  last_message_at: Date;
  renter_read_at: Date | null;
  lender_read_at: Date | null;
  renter_reminded_at: Date | null;
  lender_reminded_at: Date | null;
  renter_name: string | null;
  lender_name: string | null;
  /** The item is deleted or an account erased: read-only. */
  closed: boolean;
  /** The two have a booking of the item that went ahead (ADR-0017). */
  unlocked: boolean;
}

export interface OfferRow {
  id: string;
  conversation_id: string;
  item_id: string;
  lender_id: string;
  renter_id: string;
  start: Date;
  end: Date;
  rent_cents: number;
  deposit_cents: number;
  list_rent_cents: number;
  status: OfferStatus;
  expires_at: Date;
  booking_id: string | null;
  created_at: Date;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  kind: MessageKind;
  sender_id: string | null;
  body: string | null;
  deleted: boolean;
  system_code: SystemMessageCode | null;
  booking_id: string | null;
  offer_id: string | null;
  created_at: Date;
  /** Joined for `OFFER` messages. */
  offer: OfferRow | null;
}

const SELECT_CONVERSATIONS = `
  SELECT c.id, c.item_id, c.lender_id, c.renter_id, c.item_title,
         c.created_at, c.last_message_at, c.renter_read_at, c.lender_read_at,
         c.renter_reminded_at, c.lender_reminded_at,
         r.display_name AS renter_name, l.display_name AS lender_name,
         (COALESCE(i.status = 'DELETED', false)
          OR r.deleted_at IS NOT NULL OR l.deleted_at IS NOT NULL) AS closed,
         EXISTS (SELECT 1 FROM bookings b
                  WHERE b.item_id = c.item_id AND b.renter_id = c.renter_id
                    AND b.status = ANY($1::text[])) AS unlocked
    FROM conversations c
    LEFT JOIN users r ON r.user_id = c.renter_id
    LEFT JOIN users l ON l.user_id = c.lender_id
    LEFT JOIN items i ON i.item_id = c.item_id`;

const OFFER_COLUMNS = `
  o.id, o.conversation_id, o.item_id, o.lender_id, o.renter_id,
  lower(o.period) AS start, upper(o.period) AS "end", o.rent_cents,
  o.deposit_cents, o.list_rent_cents, o.status, o.expires_at, o.booking_id,
  o.created_at`;

const SELECT_MESSAGES = `
  SELECT m.id, m.conversation_id, m.kind, m.sender_id, m.body, m.deleted,
         m.system_code, m.booking_id, m.offer_id, m.created_at,
         CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object(
           'id', o.id, 'conversation_id', o.conversation_id,
           'item_id', o.item_id, 'lender_id', o.lender_id,
           'renter_id', o.renter_id, 'start', lower(o.period),
           'end', upper(o.period), 'rent_cents', o.rent_cents,
           'deposit_cents', o.deposit_cents,
           'list_rent_cents', o.list_rent_cents, 'status', o.status,
           'expires_at', o.expires_at, 'booking_id', o.booking_id,
           'created_at', o.created_at) END AS offer
    FROM messages m
    LEFT JOIN offers o ON o.id = m.offer_id`;

// --- conversations ------------------------------------------------------------

export async function findConversation(
  tx: EntityManager,
  id: string,
): Promise<ConversationRow | null> {
  const [row] = await tx.query(SELECT_CONVERSATIONS + ' WHERE c.id = $2', [
    UNLOCKING,
    id,
  ]);
  return row ?? null;
}

export async function findConversationFor(
  tx: EntityManager,
  itemId: string,
  renterId: string,
): Promise<ConversationRow | null> {
  const [row] = await tx.query(
    SELECT_CONVERSATIONS + ' WHERE c.item_id = $2 AND c.renter_id = $3',
    [UNLOCKING, itemId, renterId],
  );
  return row ?? null;
}

/** Locks the conversation row until the transaction ends. */
export async function lockConversation(
  tx: EntityManager,
  id: string,
): Promise<ConversationRow | null> {
  const locked: unknown[] = await tx.query(
    `SELECT 1 FROM conversations WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return locked.length > 0 ? findConversation(tx, id) : null;
}

/** The conversation of the item and asker, created if missing. */
export async function ensureConversation(
  tx: EntityManager,
  c: { itemId: string; lenderId: string; renterId: string; itemTitle: string },
): Promise<ConversationRow> {
  await tx.query(
    `INSERT INTO conversations (item_id, lender_id, renter_id, item_title)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (item_id, renter_id) DO NOTHING`,
    [c.itemId, c.lenderId, c.renterId, c.itemTitle],
  );
  return (await findConversationFor(
    tx,
    c.itemId,
    c.renterId,
  )) as ConversationRow;
}

/**
 * A page of the user's conversations, most recent activity first. A lender
 * only sees conversations with at least one message; the asker sees theirs
 * at once.
 */
export async function listConversations(
  tx: EntityManager,
  q: {
    userId: string;
    after: { at: Date; id: string } | null;
    limit: number;
  },
): Promise<ConversationRow[]> {
  return tx.query(
    SELECT_CONVERSATIONS +
      ` WHERE (c.renter_id = $2
               OR (c.lender_id = $2
                   AND EXISTS (SELECT 1 FROM messages m
                                WHERE m.conversation_id = c.id)))
          AND ($3::timestamptz IS NULL
               OR (c.last_message_at, c.id) < ($3, $4::uuid))
        ORDER BY c.last_message_at DESC, c.id DESC
        LIMIT $5::int`,
    [UNLOCKING, q.userId, q.after?.at ?? null, q.after?.id ?? null, q.limit],
  );
}

/** Every conversation the user is part of, oldest first (for the export). */
export async function listAllConversations(
  tx: EntityManager,
  userId: string,
): Promise<ConversationRow[]> {
  return tx.query(
    SELECT_CONVERSATIONS +
      ' WHERE c.renter_id = $2 OR c.lender_id = $2 ORDER BY c.created_at, c.id',
    [UNLOCKING, userId],
  );
}

export async function setReadAt(
  tx: EntityManager,
  conversationId: string,
  role: 'RENTER' | 'LENDER',
  at: Date,
): Promise<void> {
  await tx.query(
    role === 'RENTER'
      ? `UPDATE conversations SET renter_read_at = GREATEST(renter_read_at, $2)
          WHERE id = $1`
      : `UPDATE conversations SET lender_read_at = GREATEST(lender_read_at, $2)
          WHERE id = $1`,
    [conversationId, at],
  );
}

export async function setRemindedAt(
  tx: EntityManager,
  conversationId: string,
  role: 'RENTER' | 'LENDER',
  at: Date,
): Promise<void> {
  await tx.query(
    role === 'RENTER'
      ? `UPDATE conversations SET renter_reminded_at = $2 WHERE id = $1`
      : `UPDATE conversations SET lender_reminded_at = $2 WHERE id = $1`,
    [conversationId, at],
  );
}

/** Messages from the other person after `readAt` (system lines don't count). */
export async function countUnread(
  tx: EntityManager,
  conversationId: string,
  readerId: string,
  readAt: Date | null,
): Promise<number> {
  const [row] = await tx.query(
    `SELECT count(*)::int AS n FROM messages
      WHERE conversation_id = $1 AND sender_id IS NOT NULL
        AND sender_id <> $2
        AND ($3::timestamptz IS NULL OR created_at > $3)`,
    [conversationId, readerId, readAt],
  );
  return row.n;
}

/** Unread messages across all the user's conversations. */
export async function countAllUnread(
  tx: EntityManager,
  userId: string,
): Promise<number> {
  const [row] = await tx.query(
    `SELECT count(*)::int AS n
       FROM conversations c
       JOIN messages m ON m.conversation_id = c.id
      WHERE (c.renter_id = $1 OR c.lender_id = $1)
        AND m.sender_id IS NOT NULL AND m.sender_id <> $1
        AND m.created_at > COALESCE(
              CASE WHEN c.renter_id = $1 THEN c.renter_read_at
                   ELSE c.lender_read_at END, '-infinity')`,
    [userId],
  );
  return row.n;
}

/** Deletes conversations with no message since `before`; returns how many. */
export async function deleteStaleConversations(
  tx: EntityManager,
  before: Date,
): Promise<number> {
  // TypeORM returns [rows, rowCount] for DELETE.
  const [, deleted]: [unknown[], number] = await tx.query(
    `DELETE FROM conversations WHERE last_message_at < $1`,
    [before],
  );
  return deleted;
}

// --- messages -----------------------------------------------------------------

export interface NewMessage {
  id: string;
  conversationId: string;
  kind: MessageKind;
  senderId: string | null;
  body?: string;
  systemCode?: SystemMessageCode;
  bookingId?: string;
  offerId?: string;
}

/** Adds the message and moves the conversation's last activity to it. */
export async function insertMessage(
  tx: EntityManager,
  m: NewMessage,
): Promise<void> {
  await tx.query(
    `INSERT INTO messages (id, conversation_id, kind, sender_id, body,
                           system_code, booking_id, offer_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      m.id,
      m.conversationId,
      m.kind,
      m.senderId,
      m.body ?? null,
      m.systemCode ?? null,
      m.bookingId ?? null,
      m.offerId ?? null,
    ],
  );
  await tx.query(
    `UPDATE conversations SET last_message_at = m.created_at
       FROM messages m
      WHERE m.id = $1 AND conversations.id = m.conversation_id
        AND conversations.last_message_at < m.created_at`,
    [m.id],
  );
}

export async function findMessage(
  tx: EntityManager,
  id: string,
): Promise<MessageRow | null> {
  const [row] = await tx.query(SELECT_MESSAGES + ' WHERE m.id = $1', [id]);
  return row ? withDates(row) : null;
}

/** A page of the conversation, newest first (keyset on created_at, id). */
export async function listMessages(
  tx: EntityManager,
  q: {
    conversationId: string;
    before: { at: Date; id: string } | null;
    limit: number;
  },
): Promise<MessageRow[]> {
  const rows: MessageRow[] = await tx.query(
    SELECT_MESSAGES +
      ` WHERE m.conversation_id = $1
          AND ($2::timestamptz IS NULL OR (m.created_at, m.id) < ($2, $3::uuid))
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $4::int`,
    [q.conversationId, q.before?.at ?? null, q.before?.id ?? null, q.limit],
  );
  return rows.map(withDates);
}

export async function lastMessage(
  tx: EntityManager,
  conversationId: string,
): Promise<MessageRow | null> {
  const [row] = await listMessages(tx, {
    conversationId,
    before: null,
    limit: 1,
  });
  return row ?? null;
}

/** The user's own text messages, oldest first (for the export). */
export async function listOwnMessages(
  tx: EntityManager,
  conversationId: string,
  userId: string,
): Promise<Array<{ id: string; body: string | null; created_at: Date }>> {
  return tx.query(
    `SELECT id, body, created_at FROM messages
      WHERE conversation_id = $1 AND sender_id = $2 AND kind = 'TEXT'
      ORDER BY created_at, id`,
    [conversationId, userId],
  );
}

/** GDPR erasure: the text of the user's messages goes; the lines stay as "[deleted]". */
export async function eraseMessagesOf(
  tx: EntityManager,
  userId: string,
): Promise<void> {
  await tx.query(
    `UPDATE messages SET body = NULL, deleted = true
      WHERE sender_id = $1 AND kind = 'TEXT'`,
    [userId],
  );
  await tx.query(`DELETE FROM message_reports WHERE reporter_id = $1`, [
    userId,
  ]);
}

// --- offers -------------------------------------------------------------------

export interface NewOffer {
  id: string;
  conversationId: string;
  itemId: string;
  lenderId: string;
  renterId: string;
  start: Date;
  end: Date;
  rentCents: number;
  depositCents: number;
  listRentCents: number;
  expiresAt: Date;
}

export async function insertOffer(
  tx: EntityManager,
  o: NewOffer,
): Promise<void> {
  await tx.query(
    `INSERT INTO offers (id, conversation_id, item_id, lender_id, renter_id,
                         period, rent_cents, deposit_cents, list_rent_cents,
                         status, expires_at)
     VALUES ($1, $2, $3, $4, $5, tstzrange($6, $7, '[)'), $8, $9, $10,
             'OPEN', $11)`,
    [
      o.id,
      o.conversationId,
      o.itemId,
      o.lenderId,
      o.renterId,
      o.start,
      o.end,
      o.rentCents,
      o.depositCents,
      o.listRentCents,
      o.expiresAt,
    ],
  );
}

export async function findOffer(
  tx: EntityManager,
  id: string,
  options: { lock?: boolean } = {},
): Promise<OfferRow | null> {
  const [row] = await tx.query(
    'SELECT ' +
      OFFER_COLUMNS +
      ' FROM offers o WHERE o.id = $1' +
      (options.lock ? ' FOR UPDATE' : ''),
    [id],
  );
  return row ?? null;
}

/** The conversation's open offer (expired or not), locked. */
export async function lockOpenOffer(
  tx: EntityManager,
  conversationId: string,
): Promise<OfferRow | null> {
  const [row] = await tx.query(
    'SELECT ' +
      OFFER_COLUMNS +
      " FROM offers o WHERE o.conversation_id = $1 AND o.status = 'OPEN'" +
      ' FOR UPDATE',
    [conversationId],
  );
  return row ?? null;
}

export async function findOpenOffer(
  tx: EntityManager,
  conversationId: string,
): Promise<OfferRow | null> {
  const [row] = await tx.query(
    'SELECT ' +
      OFFER_COLUMNS +
      " FROM offers o WHERE o.conversation_id = $1 AND o.status = 'OPEN'",
    [conversationId],
  );
  return row ?? null;
}

/** Open offers of an item, or involving a user, locked (for deletions). */
export async function lockOpenOffers(
  tx: EntityManager,
  where: { itemId: string } | { userId: string },
): Promise<OfferRow[]> {
  return tx.query(
    'SELECT ' +
      OFFER_COLUMNS +
      " FROM offers o WHERE o.status = 'OPEN' AND " +
      ('itemId' in where
        ? 'o.item_id = $1'
        : '(o.lender_id = $1 OR o.renter_id = $1)') +
      ' ORDER BY o.id FOR UPDATE',
    ['itemId' in where ? where.itemId : where.userId],
  );
}

export async function setOfferStatus(
  tx: EntityManager,
  id: string,
  status: OfferStatus,
  bookingId: string | null = null,
): Promise<void> {
  await tx.query(
    `UPDATE offers SET status = $2, booking_id = COALESCE($3, booking_id)
      WHERE id = $1`,
    [id, status, bookingId],
  );
}

/** Offers the user sent or received, oldest first (for the export). */
export async function listOffersOf(
  tx: EntityManager,
  userId: string,
): Promise<OfferRow[]> {
  return tx.query(
    'SELECT ' +
      OFFER_COLUMNS +
      ' FROM offers o WHERE o.lender_id = $1 OR o.renter_id = $1' +
      ' ORDER BY o.created_at, o.id',
    [userId],
  );
}

// --- reports ------------------------------------------------------------------

/** Reporting the same message again keeps the first report. */
export async function insertReport(
  tx: EntityManager,
  messageId: string,
  reporterId: string,
  reason: ReportReason,
): Promise<void> {
  await tx.query(
    `INSERT INTO message_reports (message_id, reporter_id, reason)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [messageId, reporterId, reason],
  );
}

export async function listReportsBy(
  tx: EntityManager,
  reporterId: string,
): Promise<
  Array<{ message_id: string; reason: ReportReason; created_at: Date }>
> {
  return tx.query(
    `SELECT message_id, reason, created_at FROM message_reports
      WHERE reporter_id = $1 ORDER BY created_at`,
    [reporterId],
  );
}

/** json_build_object returns timestamps as strings. */
function withDates(row: MessageRow): MessageRow {
  if (!row.offer) return row;
  const o = row.offer as unknown as Record<string, unknown>;
  return {
    ...row,
    offer: {
      ...(row.offer as OfferRow),
      start: new Date(o['start'] as string),
      end: new Date(o['end'] as string),
      expires_at: new Date(o['expires_at'] as string),
      created_at: new Date(o['created_at'] as string),
    },
  };
}
