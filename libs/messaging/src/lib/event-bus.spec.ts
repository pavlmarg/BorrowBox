import { connect as amqpConnect, type ChannelModel } from 'amqplib';
import {
  createEnvelope,
  defineEvent,
  EVENTS_EXCHANGE,
  type EventEnvelope,
} from '@borrowbox/contracts';
import { startRabbitMq, type TestRabbitMq } from '@borrowbox/testing';
import { EventBus, type EventContext, type MessagingLogger } from './event-bus';
import {
  LAST_ERROR_HEADER,
  ORIGINAL_ROUTING_KEY_HEADER,
  RETRY_COUNT_HEADER,
} from './topology';

const ItemCreatedV1 = defineEvent<{ itemId: string }>()('item.created', 1);
const ItemDeletedV1 = defineEvent<{ itemId: string }>()('item.deleted', 1);

const silentLogger: MessagingLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

async function waitFor<T>(
  fn: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('EventBus (RabbitMQ integration)', () => {
  let rabbit: TestRabbitMq;
  let bus: EventBus;
  let raw: ChannelModel;
  let queueSeq = 0;
  const nextQueue = () => `test.queue-${++queueSeq}`;

  beforeAll(async () => {
    rabbit = await startRabbitMq();
    bus = await EventBus.connect({ url: rabbit.url, logger: silentLogger });
    raw = await amqpConnect(rabbit.url);
  });

  afterAll(async () => {
    await raw?.close();
    await bus?.close();
    await rabbit?.stop();
  });

  async function getOne(queue: string) {
    const ch = await raw.createChannel();
    try {
      const msg = await ch.get(queue, { noAck: true });
      return msg === false ? undefined : msg;
    } finally {
      await ch.close();
    }
  }

  it('delivers only events matching the bound routing keys', async () => {
    const received: Array<{ env: EventEnvelope; ctx: EventContext }> = [];
    const sub = await bus.subscribe({
      queue: nextQueue(),
      routingKeys: [ItemCreatedV1.routingKey],
      handler: async (env, ctx) => {
        received.push({ env, ctx });
      },
    });

    const created = createEnvelope(ItemCreatedV1, { itemId: 'i-1' });
    await bus.publish(createEnvelope(ItemDeletedV1, { itemId: 'i-1' }));
    await bus.publish(created);

    await waitFor(() => (received.length > 0 ? true : undefined));
    await new Promise((r) => setTimeout(r, 300)); // give a stray message time to arrive
    expect(received).toHaveLength(1);
    expect(received[0].env).toEqual(created);
    expect(received[0].ctx).toEqual({
      routingKey: 'item.created.v1',
      retryCount: 0,
    });
    await sub.close();
  });

  it('retries a failing handler with backoff, then succeeds', async () => {
    const calls: EventContext[] = [];
    const queue = nextQueue();
    const sub = await bus.subscribe({
      queue,
      routingKeys: [ItemCreatedV1.routingKey],
      retryDelaysMs: [50, 50, 50],
      handler: async (_env, ctx) => {
        calls.push(ctx);
        if (calls.length < 3) throw new Error(`boom ${calls.length}`);
      },
    });

    await bus.publish(createEnvelope(ItemCreatedV1, { itemId: 'i-2' }));

    await waitFor(() => (calls.length >= 3 ? true : undefined));
    expect(calls.map((c) => c.retryCount)).toEqual([0, 1, 2]);
    // The original routing key survives the round trip through retry queues.
    expect(calls.every((c) => c.routingKey === 'item.created.v1')).toBe(true);
    expect(await getOne(`${queue}.dlq`)).toBeUndefined();
    await sub.close();
  });

  it('dead-letters after the retries are exhausted', async () => {
    let calls = 0;
    const queue = nextQueue();
    const sub = await bus.subscribe({
      queue,
      routingKeys: [ItemCreatedV1.routingKey],
      retryDelaysMs: [50, 50, 50],
      handler: async () => {
        calls++;
        throw new Error('always fails');
      },
    });

    const env = createEnvelope(ItemCreatedV1, { itemId: 'i-3' });
    await bus.publish(env);

    const dead = await waitFor(() => getOne(`${queue}.dlq`));
    expect(calls).toBe(4); // first attempt + 3 retries
    expect(JSON.parse(dead.content.toString())).toEqual(env);
    expect(dead.properties.messageId).toBe(env.eventId);
    expect(dead.properties.headers?.[RETRY_COUNT_HEADER]).toBe(3);
    expect(dead.properties.headers?.[LAST_ERROR_HEADER]).toBe('always fails');
    expect(dead.properties.headers?.[ORIGINAL_ROUTING_KEY_HEADER]).toBe(
      'item.created.v1',
    );
    await sub.close();
  });

  it('sends malformed messages straight to the DLQ without calling the handler', async () => {
    const handler = jest.fn(async () => undefined);
    const queue = nextQueue();
    const sub = await bus.subscribe({
      queue,
      routingKeys: [ItemCreatedV1.routingKey],
      retryDelaysMs: [50],
      handler,
    });

    const ch = await raw.createChannel();
    ch.publish(EVENTS_EXCHANGE, 'item.created.v1', Buffer.from('{not json'));
    await ch.close();

    const dead = await waitFor(() => getOne(`${queue}.dlq`));
    expect(dead.content.toString()).toBe('{not json');
    expect(dead.properties.headers?.[LAST_ERROR_HEADER]).toBe('malformed JSON');
    expect(handler).not.toHaveBeenCalled();
    await sub.close();
  });

  it('re-asserting the same topology is idempotent', async () => {
    const queue = nextQueue();
    const opts = {
      queue,
      routingKeys: [ItemCreatedV1.routingKey],
      retryDelaysMs: [50],
      handler: async () => undefined,
    };
    const a = await bus.subscribe(opts);
    await a.close();
    const b = await bus.subscribe(opts);
    await b.close();
  });
});

describe('EventBus while the broker is unreachable', () => {
  it('rejects publish after publishTimeoutMs instead of waiting for a reconnect', async () => {
    const rabbit = await startRabbitMq();
    const bus = await EventBus.connect({
      url: rabbit.url,
      logger: silentLogger,
      publishTimeoutMs: 500,
    });
    try {
      await rabbit.stop();

      const started = Date.now();
      await expect(
        bus.publish(createEnvelope(ItemCreatedV1, { itemId: 'i-1' })),
      ).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await bus.close();
    }
  });
});
