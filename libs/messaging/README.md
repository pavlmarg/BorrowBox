# @borrowbox/messaging

RabbitMQ connection and topology (ADR-0001), built on `amqp-connection-manager`
so channels reconnect and topology is re-asserted automatically.

## Topology per consumer

```
borrowbox.events (topic) ──routing keys──▶ <queue>
  handler throws ─▶ <queue>.retry.<n>   TTL = delay n, then back to <queue>
  retries exhausted / malformed JSON ─▶ <queue>.dlq
```

- Queue names are `<service>.<purpose>`, e.g. `notifications.booking-events`.
- Default backoff: 5 s, 30 s, 120 s (3 retries), then the DLQ.
- Messages are moved to retry/DLQ with a publisher confirm **before** the
  original is acked, so nothing is lost, but duplicates are possible.
  **Handlers must be idempotent** (use `@borrowbox/outbox`'s consumer helper).
- Changing a queue's retry delays later requires deleting its retry queues
  (RabbitMQ rejects re-declaring a queue with different arguments).

## Usage

```ts
const bus = await EventBus.connect({ url, logger });

await bus.subscribe({
  queue: 'notifications.booking-events',
  routingKeys: ['booking.accepted.v1'],
  handler: async (envelope, { routingKey, retryCount }) => { /* idempotent */ },
});
```

`bus.publish()` resolves on the broker's confirm and rejects after
`publishTimeoutMs` (default 10 s), e.g. while RabbitMQ is unreachable, so the
relay records a failure and retries instead of hanging.

`bus.publish()` is only for the outbox relay. Business code never publishes
directly — it writes to its schema's outbox in the same DB transaction.

Never log event payloads; they can contain personal data.
