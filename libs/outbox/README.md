# @borrowbox/outbox

Transactional outbox and idempotent consumers (ARCHITECTURE.md §4, "Reliability
patterns"), on TypeORM + Postgres.

## Tables

`CreateOutboxTables1759140000000` creates `outbox` and `processed_events`.
Table names are unqualified: each service's DB role has
`search_path = <its schema>, public`, so they land in `<schema>.outbox` and
`<schema>.processed_events`. Add the migration to the service DataSource.

## Publishing — state change + event in one transaction

```ts
await dataSource.transaction(async (tx) => {
  await tx.save(booking);
  await addToOutbox(tx, createEnvelope(BookingAcceptedV1, payload, { causedBy }));
});
```

`addToOutbox` throws if it isn't inside a transaction. Never publish to
RabbitMQ from business code.

## Relay

```ts
const relay = new OutboxRelay({ dataSource, publish: (e) => bus.publish(e) });
relay.start(); // on shutdown: await relay.stop()
```

Polls unpublished rows in insertion order with `FOR UPDATE SKIP LOCKED` (safe
to run several instances), publishes with broker confirms, then marks them
published. On a publish error it records `attempts`/`last_error` and stops the
batch so later events don't overtake it. Delivery is at-least-once.

Published rows are kept for now; a retention/cleanup job is future work.

## Consuming — at most once per consumer

```ts
await handleOnce(dataSource, 'bookings.item-events', envelope, async (tx) => {
  // side effect, using tx
});
```

The `processed_events` row (keyed on consumer + `eventId`) and the side effect
commit together. Duplicates return `false` without running the side effect;
a thrown error rolls back both so the event can be retried.
