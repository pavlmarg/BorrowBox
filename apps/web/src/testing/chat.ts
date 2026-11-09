// Test-only helpers (excluded from the app build).
import type {
  ConversationViewResponse,
  MessageViewResponse,
  OfferViewResponse,
} from '../app/api/models';

export const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
export const ITEM_ID = '22222222-2222-4222-8222-222222222222';
export const OTHER_ID = '33333333-3333-4333-8333-333333333333';

export function conversation(
  overrides: Partial<ConversationViewResponse> = {},
): ConversationViewResponse {
  return {
    id: CONVERSATION_ID,
    itemId: ITEM_ID,
    itemTitle: 'Cordless drill',
    role: 'RENTER',
    other: { userId: OTHER_ID, displayName: 'Maria' },
    lastMessage: null,
    lastMessageAt: '2026-11-09T09:00:00.000Z',
    unreadCount: 0,
    otherReadAt: null,
    closed: false,
    openOffer: null,
    createdAt: '2026-11-09T08:00:00.000Z',
    ...overrides,
  };
}

export function message(
  id: string,
  overrides: Partial<MessageViewResponse> = {},
): MessageViewResponse {
  return {
    id,
    conversationId: CONVERSATION_ID,
    kind: 'TEXT',
    senderId: OTHER_ID,
    mine: false,
    text: `text ${id}`,
    deleted: false,
    systemCode: null,
    bookingId: null,
    offer: null,
    sentAt: '2026-11-09T09:00:00.000Z',
    ...overrides,
  };
}

export function offer(
  overrides: Partial<OfferViewResponse> = {},
): OfferViewResponse {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    conversationId: CONVERSATION_ID,
    itemId: ITEM_ID,
    start: '2026-11-20T08:00:00.000Z',
    end: '2026-11-21T08:00:00.000Z',
    rentCents: 1500,
    depositCents: 5000,
    feeCents: 150,
    totalCents: 6650,
    listRentCents: 2000,
    status: 'OPEN',
    expiresAt: '2099-11-11T08:00:00.000Z',
    bookingId: null,
    createdAt: '2026-11-09T09:00:00.000Z',
    ...overrides,
  };
}
