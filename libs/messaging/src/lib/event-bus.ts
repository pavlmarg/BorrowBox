import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import {
  connect,
  type AmqpConnectionManager,
  type ChannelWrapper,
} from 'amqp-connection-manager';
import {
  EVENTS_EXCHANGE,
  routingKeyOf,
  type EventEnvelope,
} from '@borrowbox/contracts';
import {
  consumerTopology,
  DEFAULT_RETRY_DELAYS_MS,
  LAST_ERROR_HEADER,
  ORIGINAL_ROUTING_KEY_HEADER,
  RETRY_COUNT_HEADER,
  type ConsumerTopology,
} from './topology';

/** Structured logger (pino-compatible). Never pass payloads — they may hold personal data. */
export interface MessagingLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

const consoleLogger: MessagingLogger = {
  info: (obj, msg) => console.info(msg, obj),
  warn: (obj, msg) => console.warn(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
};

export interface EventContext {
  /** Routing key the event was published with, e.g. `booking.accepted.v1`. */
  routingKey: string;
  /** Number of earlier failed attempts (0 on first delivery). */
  retryCount: number;
}

/** Must be idempotent: delivery is at-least-once. */
export type EventHandler = (
  envelope: EventEnvelope,
  context: EventContext,
) => Promise<void>;

export interface SubscribeOptions {
  /** `<service>.<purpose>`, e.g. `notifications.booking-events`. */
  queue: string;
  /** Versioned routing keys, e.g. `booking.accepted.v1` (topic wildcards allowed). */
  routingKeys: readonly string[];
  handler: EventHandler;
  retryDelaysMs?: readonly number[];
  prefetch?: number;
}

export interface Subscription {
  close(): Promise<void>;
}

/** Default for {@link EventBusOptions.publishTimeoutMs}. */
export const DEFAULT_PUBLISH_TIMEOUT_MS = 10_000;

export interface EventBusOptions {
  url: string;
  logger?: MessagingLogger;
  /**
   * `publish` rejects if the broker hasn't confirmed within this time (e.g.
   * while disconnected), so the outbox relay records a failure and retries
   * instead of holding its transaction open indefinitely.
   */
  publishTimeoutMs?: number;
}

interface MoveMeta {
  retryCount: number;
  routingKey: string;
  lastError: string;
}

/**
 * RabbitMQ connection with automatic reconnect. Topology is (re)asserted on
 * every (re)connect.
 *
 * `publish` is meant for the outbox relay only — business code writes to the
 * outbox inside its DB transaction instead (see @borrowbox/outbox).
 */
export class EventBus {
  private readonly subscriptions = new Set<ChannelWrapper>();

  private constructor(
    private readonly connection: AmqpConnectionManager,
    private readonly publisher: ChannelWrapper,
    private readonly logger: MessagingLogger,
  ) {}

  static async connect(options: EventBusOptions): Promise<EventBus> {
    const logger = options.logger ?? consoleLogger;
    const connection = connect([options.url]);
    connection.on('disconnect', ({ err }) =>
      logger.warn({ err: err?.message }, 'RabbitMQ disconnected'),
    );

    const publisher = connection.createChannel({
      publishTimeout: options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS,
      setup: (ch: ConfirmChannel) =>
        ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true }),
    });
    await publisher.waitForConnect();
    return new EventBus(connection, publisher, logger);
  }

  /**
   * Resolves once the broker has confirmed the message is stored; rejects
   * after `publishTimeoutMs` (e.g. while RabbitMQ is unreachable).
   */
  async publish(envelope: EventEnvelope): Promise<void> {
    await this.publisher.publish(
      EVENTS_EXCHANGE,
      routingKeyOf(envelope),
      Buffer.from(JSON.stringify(envelope)),
      {
        persistent: true,
        contentType: 'application/json',
        messageId: envelope.eventId,
        correlationId: envelope.correlationId,
        type: envelope.type,
        timestamp: Math.floor(Date.parse(envelope.occurredAt) / 1000),
      },
    );
  }

  async subscribe(options: SubscribeOptions): Promise<Subscription> {
    const topology = consumerTopology(
      options.queue,
      options.routingKeys,
      options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS,
    );

    const channel = this.connection.createChannel({
      setup: (ch: ConfirmChannel) => assertConsumerTopology(ch, topology),
    });
    this.subscriptions.add(channel);
    await channel.waitForConnect();

    await channel.consume(
      topology.queue.name,
      (msg) => this.handleMessage(channel, topology, options.handler, msg),
      { prefetch: options.prefetch ?? 10 },
    );

    return {
      close: async () => {
        this.subscriptions.delete(channel);
        await channel.close();
      },
    };
  }

  async close(): Promise<void> {
    await Promise.all([...this.subscriptions].map((c) => c.close()));
    this.subscriptions.clear();
    await this.publisher.close();
    await this.connection.close();
  }

  private async handleMessage(
    channel: ChannelWrapper,
    topology: ConsumerTopology,
    handler: EventHandler,
    msg: ConsumeMessage,
  ): Promise<void> {
    const headers = msg.properties.headers ?? {};
    const retryCount = Number(headers[RETRY_COUNT_HEADER] ?? 0);
    // Retried messages come back from the retry queue keyed by queue name.
    const routingKey = String(
      headers[ORIGINAL_ROUTING_KEY_HEADER] ?? msg.fields.routingKey,
    );
    const log = {
      queue: topology.queue.name,
      routingKey,
      eventId: msg.properties.messageId,
      correlationId: msg.properties.correlationId,
      retryCount,
    };

    const target = await this.dispatch(topology, handler, msg, {
      routingKey,
      retryCount,
      log,
    });
    if (!target) {
      channel.ack(msg);
      return;
    }

    try {
      await this.moveTo(channel, target.queue, msg, target.meta);
    } catch (moveErr) {
      // Couldn't park it; put it back so it isn't lost.
      this.logger.error(
        {
          ...log,
          err: moveErr instanceof Error ? moveErr.message : String(moveErr),
        },
        'Failed to move event to retry/DLQ, requeueing',
      );
      channel.nack(msg, false, true);
    }
  }

  /**
   * Runs the handler. Returns null on success, otherwise where the message
   * should be parked: the next retry queue, or the DLQ.
   */
  private async dispatch(
    topology: ConsumerTopology,
    handler: EventHandler,
    msg: ConsumeMessage,
    ctx: EventContext & { log: Record<string, unknown> },
  ): Promise<{ queue: string; meta: MoveMeta } | null> {
    const { routingKey, retryCount, log } = ctx;

    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(msg.content.toString('utf8')) as EventEnvelope;
    } catch {
      // Retrying can't fix a malformed message.
      this.logger.error(log, 'Malformed event, sending to DLQ');
      return {
        queue: topology.deadLetterQueue.name,
        meta: { retryCount, routingKey, lastError: 'malformed JSON' },
      };
    }

    try {
      await handler(envelope, { routingKey, retryCount });
      return null;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const retryQueue = topology.retryQueues[retryCount];
      if (retryQueue) {
        this.logger.warn(
          { ...log, err: reason },
          'Event handler failed, scheduling retry',
        );
        return {
          queue: retryQueue.name,
          meta: { retryCount: retryCount + 1, routingKey, lastError: reason },
        };
      }
      this.logger.error(
        { ...log, err: reason },
        'Event handler failed, retries exhausted, sending to DLQ',
      );
      return {
        queue: topology.deadLetterQueue.name,
        meta: { retryCount, routingKey, lastError: reason },
      };
    }
  }

  /** Copies the message to `queue` and acks the original only after the broker confirms. */
  private async moveTo(
    channel: ChannelWrapper,
    queue: string,
    msg: ConsumeMessage,
    meta: MoveMeta,
  ): Promise<void> {
    await channel.sendToQueue(queue, msg.content, {
      ...msg.properties,
      persistent: true,
      headers: {
        ...msg.properties.headers,
        [RETRY_COUNT_HEADER]: meta.retryCount,
        [LAST_ERROR_HEADER]: meta.lastError.slice(0, 500),
        [ORIGINAL_ROUTING_KEY_HEADER]: meta.routingKey,
      },
    });
    channel.ack(msg);
  }
}

async function assertConsumerTopology(
  ch: ConfirmChannel,
  topology: ConsumerTopology,
): Promise<void> {
  await ch.assertExchange(topology.exchange, 'topic', { durable: true });
  await ch.assertQueue(topology.queue.name, { durable: true });
  for (const key of topology.bindings) {
    await ch.bindQueue(topology.queue.name, topology.exchange, key);
  }
  for (const retry of topology.retryQueues) {
    await ch.assertQueue(retry.name, {
      durable: true,
      arguments: retry.arguments,
    });
  }
  await ch.assertQueue(topology.deadLetterQueue.name, { durable: true });
}
