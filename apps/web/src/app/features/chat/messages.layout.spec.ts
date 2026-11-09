import { openConversationId } from './messages.layout';

describe('openConversationId', () => {
  it.each([
    ['/messages', null],
    ['/messages?x=1', null],
    ['/messages/c-1', 'c-1'],
    ['/messages/c-1?x=1', 'c-1'],
    ['/bookings/c-1', null],
  ])('%s → %s', (url, id) => {
    expect(openConversationId(url)).toBe(id);
  });
});
