import {
  ConversationUnreadV1,
  MessageSentV1,
  OfferSentV1,
  OfferWithdrawnV1,
} from './events';
import { MessagingRpc } from './rpc';

describe('messaging contracts', () => {
  it('have versioned routing keys', () => {
    expect(
      [MessageSentV1, ConversationUnreadV1, OfferSentV1, OfferWithdrawnV1].map(
        (e) => e.routingKey,
      ),
    ).toEqual([
      'message.sent.v1',
      'conversation.unread.v1',
      'offer.sent.v1',
      'offer.withdrawn.v1',
    ]);
  });

  it('keeps RPC patterns unique', () => {
    const patterns = Object.values(MessagingRpc);
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});
