import { EVENTS_EXCHANGE } from '@borrowbox/contracts';

/** Default backoff between attempts: 3 retries (ADR-0001), then the DLQ. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [
  5_000, 30_000, 120_000,
];

/** Header carrying how many retries a message has already had. */
export const RETRY_COUNT_HEADER = 'x-borrowbox-retry-count';
/** Routing key the event was published with (retries come back keyed by queue name). */
export const ORIGINAL_ROUTING_KEY_HEADER = 'x-borrowbox-routing-key';
/** Header set on retried/dead-lettered messages with the last error message. */
export const LAST_ERROR_HEADER = 'x-borrowbox-last-error';

// `<service>.<purpose>`, e.g. `notifications.booking-events`
const QUEUE_NAME_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

export interface QueueDeclaration {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ConsumerTopology {
  exchange: string;
  queue: QueueDeclaration;
  bindings: string[];
  /** One queue per attempt; index 0 is the first retry. */
  retryQueues: QueueDeclaration[];
  deadLetterQueue: QueueDeclaration;
}

/**
 * Per-consumer topology (ADR-0001):
 *
 *   borrowbox.events ──(routing keys)──▶ <queue>
 *   handler fails ─▶ <queue>.retry.<n>  (TTL = delay n, then dead-letters back to <queue>)
 *   retries exhausted / malformed ─▶ <queue>.dlq
 *
 * A retry queue per attempt (rather than per-message TTL on one queue) avoids
 * head-of-line blocking: every message in a retry queue has the same TTL.
 */
export function consumerTopology(
  queue: string,
  routingKeys: readonly string[],
  retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): ConsumerTopology {
  if (!QUEUE_NAME_PATTERN.test(queue)) {
    throw new Error(
      `Invalid queue name "${queue}": expected "<service>.<purpose>" in lower kebab-case`,
    );
  }
  if (routingKeys.length === 0) {
    throw new Error(`Queue "${queue}" must bind at least one routing key`);
  }
  if (retryDelaysMs.some((d) => !Number.isInteger(d) || d <= 0)) {
    throw new Error('Retry delays must be positive integers (milliseconds)');
  }

  return {
    exchange: EVENTS_EXCHANGE,
    queue: { name: queue },
    bindings: [...routingKeys],
    retryQueues: retryDelaysMs.map((delay, i) => ({
      name: `${queue}.retry.${i + 1}`,
      arguments: {
        'x-message-ttl': delay,
        // Expired messages go back to the main queue via the default exchange.
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': queue,
      },
    })),
    deadLetterQueue: { name: `${queue}.dlq` },
  };
}
