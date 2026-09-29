import {
  createEnvelope,
  defineEvent,
  parseRoutingKey,
  routingKeyOf,
  toRoutingKey,
} from './envelope';

const TestEventV1 = defineEvent<{ itemId: string }>()('item.created', 1);

describe('routing keys', () => {
  it('builds <aggregate>.<event>.v<N>', () => {
    expect(toRoutingKey('booking.accepted', 1)).toBe('booking.accepted.v1');
    expect(toRoutingKey('user.deletion_requested', 2)).toBe(
      'user.deletion_requested.v2',
    );
  });

  it.each([
    'booking',
    'Booking.accepted',
    'booking.accepted.v1',
    'booking..x',
    '',
  ])('rejects malformed type %p', (type) =>
    expect(() => toRoutingKey(type, 1)).toThrow(/Invalid event type/),
  );

  it.each([0, -1, 1.5, NaN])('rejects version %p', (version) =>
    expect(() => toRoutingKey('booking.accepted', version)).toThrow(
      /Invalid event version/,
    ),
  );

  it('round-trips through parseRoutingKey', () => {
    expect(parseRoutingKey('payment.captured.v12')).toEqual({
      type: 'payment.captured',
      version: 12,
    });
    expect(() => parseRoutingKey('payment.captured')).toThrow(
      /Invalid routing key/,
    );
    expect(() => parseRoutingKey('payment.captured.v0')).toThrow(
      /Invalid routing key/,
    );
  });
});

describe('defineEvent', () => {
  it('precomputes the routing key and is immutable', () => {
    expect(TestEventV1.routingKey).toBe('item.created.v1');
    expect(Object.isFrozen(TestEventV1)).toBe(true);
  });

  it('fails fast on an invalid definition', () => {
    expect(() => defineEvent<unknown>()('itemcreated', 1)).toThrow();
  });
});

describe('createEnvelope', () => {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('fills the standard envelope fields', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    const env = createEnvelope(
      TestEventV1,
      { itemId: 'i-1' },
      { occurredAt: at },
    );

    expect(env).toEqual({
      eventId: expect.stringMatching(uuid),
      type: 'item.created',
      version: 1,
      occurredAt: '2026-01-02T03:04:05.000Z',
      correlationId: env.eventId,
      causationId: null,
      payload: { itemId: 'i-1' },
    });
    expect(routingKeyOf(env)).toBe('item.created.v1');
  });

  it('generates a unique eventId per call', () => {
    const a = createEnvelope(TestEventV1, { itemId: 'x' });
    const b = createEnvelope(TestEventV1, { itemId: 'x' });
    expect(a.eventId).not.toBe(b.eventId);
  });

  it('uses an explicit correlationId for a new flow', () => {
    const env = createEnvelope(
      TestEventV1,
      { itemId: 'x' },
      { correlationId: 'req-42' },
    );
    expect(env.correlationId).toBe('req-42');
    expect(env.causationId).toBeNull();
  });

  it('inherits correlation and sets causation from the causing event', () => {
    const cause = createEnvelope(
      TestEventV1,
      { itemId: 'x' },
      { correlationId: 'flow-1' },
    );
    const effect = createEnvelope(
      TestEventV1,
      { itemId: 'y' },
      { causedBy: cause, correlationId: 'ignored' },
    );
    expect(effect.correlationId).toBe('flow-1');
    expect(effect.causationId).toBe(cause.eventId);
  });
});
