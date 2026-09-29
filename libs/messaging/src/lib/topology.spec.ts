import { consumerTopology, DEFAULT_RETRY_DELAYS_MS } from './topology';

describe('consumerTopology', () => {
  it('declares main, per-attempt retry and dead-letter queues', () => {
    const t = consumerTopology('notifications.booking-events', [
      'booking.accepted.v1',
      'booking.declined.v1',
    ]);

    expect(t.exchange).toBe('borrowbox.events');
    expect(t.queue.name).toBe('notifications.booking-events');
    expect(t.bindings).toEqual(['booking.accepted.v1', 'booking.declined.v1']);
    expect(t.deadLetterQueue.name).toBe('notifications.booking-events.dlq');
    expect(t.retryQueues).toHaveLength(3);
    expect(DEFAULT_RETRY_DELAYS_MS).toHaveLength(3);

    t.retryQueues.forEach((q, i) => {
      expect(q.name).toBe(`notifications.booking-events.retry.${i + 1}`);
      expect(q.arguments).toEqual({
        'x-message-ttl': DEFAULT_RETRY_DELAYS_MS[i],
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': 'notifications.booking-events',
      });
    });
  });

  it('honours custom retry delays', () => {
    const t = consumerTopology(
      'bookings.item-events',
      ['item.*.v1'],
      [100, 200],
    );
    expect(t.retryQueues.map((q) => q.arguments?.['x-message-ttl'])).toEqual([
      100, 200,
    ]);
  });

  it.each(['bookings', 'Bookings.items', 'bookings.item_events', 'a.b.c'])(
    'rejects queue name %p',
    (name) => expect(() => consumerTopology(name, ['x.y.v1'])).toThrow(),
  );

  it('rejects empty bindings and invalid delays', () => {
    expect(() => consumerTopology('a.b', [])).toThrow();
    expect(() => consumerTopology('a.b', ['x.y.v1'], [0])).toThrow();
    expect(() => consumerTopology('a.b', ['x.y.v1'], [1.5])).toThrow();
  });
});
