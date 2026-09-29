# ADR-0001: Use RabbitMQ as the message broker

**Status:** Accepted

## Context
Services communicate asynchronously. The original plan listed "RabbitMQ / Kafka". The workload is business events (booking accepted, payment captured) at low-to-moderate volume, built and run by one developer.

## Decision
Use **RabbitMQ**, with one topic exchange `borrowbox.events` and versioned routing keys (`booking.accepted.v1`). Each consumer gets its own queue, a retry queue with TTL backoff, and a dead-letter queue.

## Consequences
- NestJS supports it natively, it runs as a small container, and routing, retries and DLQs are easy to set up.
- It doesn't keep a replayable event log. If that's ever needed for analytics or event sourcing, Kafka or Redpanda can be added alongside it.
- Delivery is at-least-once, so consumers must be idempotent (see the outbox lib).
