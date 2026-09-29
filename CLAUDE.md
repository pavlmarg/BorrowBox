# CLAUDE.md — BorrowBox

Peer-to-peer rental platform for neighbours (Greece/EU launch). Solo developer, portfolio/learning project
that should be able to grow into a real product. Microservices + event-driven design are deliberate learning goals:
don't "simplify" them away, but don't add infrastructure beyond what the docs describe.

Full design (read before any structural change): @docs/ARCHITECTURE.md

ADRs — read the relevant one before touching that area:
- Messaging / RabbitMQ topology → `docs/adr/0001-rabbitmq.md`
- Monorepo layout, DB schemas & roles → `docs/adr/0002-nx-monorepo-schema-per-service.md`
- Anything involving money / Stripe → `docs/adr/0003-stripe-separate-charges-transfers.md`
- Item locations, maps, photos → `docs/adr/0004-location-fuzzing.md`

---

## Current phase

**Phase 1 – Identity & Gateway** (update this line as phases complete; see roadmap in `README.md`).

- Only build what the current phase needs. If a task seems to require a later-phase feature, stop and ask.
- Messaging and Reviews start as modules inside `apps/bookings` until their event contracts settle.

## How to work

1. **Plan first.** For anything touching more than one file, state the plan (files, events, schema changes) and wait for approval.
2. **Small, reviewable diffs.** One concern per change. Don't reformat or refactor unrelated code.
3. **Ask before** adding a dependency, a new service/app, a new infrastructure container, or changing an ADR decision.
4. **If you deviate from an ADR,** say so explicitly and draft a new ADR in `docs/adr/` (next number, same format: Status / Context / Decision / Consequences) instead of silently diverging.
5. **Verify before claiming done:** run lint, tests and build for affected projects and report the results honestly, including failures.
6. **Keep docs in sync.** If behaviour described in `docs/ARCHITECTURE.md` changes, update it in the same change.

## Commands

- First time: `npm ci`, then `cp infra/.env.example infra/.env` (host ports are overridable there)
- Start infra: `docker compose -f infra/docker-compose.yml up -d --wait`
- Affected checks: `npx nx affected -t lint test build` (Docker must be running: integration tests use Testcontainers)
- Single project: `npx nx test <project>`, `npx nx serve <project>`
- Formatting: `npx nx format:write` (Markdown is excluded on purpose)
- Observability profile: `infra/docker-compose.observability.yml` — not created yet (Phase 7)

## Shared libs (use these, don't re-implement)

- `@borrowbox/contracts` — `defineEvent`, `createEnvelope`, `EVENTS_EXCHANGE`; one definition per event version.
- `@borrowbox/outbox` — `addToOutbox(tx, envelope)`, `OutboxRelay`, `handleOnce(ds, consumer, envelope, fn)`, `CreateOutboxTables…` migration.
- `@borrowbox/messaging` — `EventBus` (subscribe with retry queues + DLQ; `publish` only from the relay).
- `@borrowbox/testing` — `startPostgres()` (real per-service roles), `startRabbitMq()`. Spec files only (lint-enforced).

## Non-negotiable invariants

### Service boundaries & data
- Each service owns exactly one Postgres schema and DB role. **Never** read or write another service's schema.
- Need another service's data? Build a local read model from events (e.g. Bookings keeps item title / lender id / deposit from `item.*`).
- Services **never** call each other synchronously during a business flow. Gateway → service RPC is only for queries and user-initiated commands.
- The gateway is stateless and owns no data.

### Events
- Every state change and its event are written in **one DB transaction** to `<schema>.outbox`. Never publish to RabbitMQ directly from business code.
- Every consumer is idempotent: record `event_id` in `<schema>.processed_events` in the same transaction as the side effect.
- Exchange `borrowbox.events`, routing keys versioned: `<aggregate>.<event>.v<N>`.
- All event and DTO types live in `libs/contracts`. Never make a breaking change to an existing version — add `v2` and support both until consumers migrate.
- Use the standard envelope: `{ eventId, type, version, occurredAt, correlationId, causationId, payload }`.

### Bookings
- State changes only through the state machine in ARCHITECTURE.md §4. No direct status updates elsewhere.
- Keep the DB exclusion constraint that prevents double-booking; don't replace it with app-level checks.
- BullMQ delayed jobs (expiry, claim window) must re-check current state before acting.
- QR handoff: follow §5 exactly (Ed25519-signed token, 45 s expiry, single-use nonce via Redis `SET NX`, scanner must be the counterparty).

### Payments (money is high-risk — go slowly)
- Store amounts as **integer cents, EUR**. No floats for money.
- One PaymentIntent per booking (`rent + deposit + fee`) with `transfer_group = booking_<id>`. Transfers and refunds happen only in response to booking events.
- Stripe webhooks: verify the signature against the **raw body**, store in `payments.stripe_events` (unique on Stripe event id), process asynchronously.
- Use Stripe **test mode** only. Never hard-code keys; never log full Stripe payloads containing personal data.

### Privacy & security (GDPR)
- Public endpoints return `location_public` only — never `location`. Exact address only for a renter with a `PAID` booking, until completion.
- Every uploaded photo goes through the media worker (EXIF/GPS stripped) before it's served.
- Never log passwords, tokens, full addresses, or payment details.
- New personal data must be covered by `GET /me/export` and the `user.deletion_requested` handler for that service.
- Validate all input with `class-validator`; resource-level authorization lives in the owning service.
- Secrets come from env / Docker secrets. Never commit `.env` files or credentials.

### Frontend (Angular PWA)
- Standalone components, Signals, NgRx SignalStore per feature, lazy-loaded feature routes.
- Use the API client generated from the gateway's OpenAPI spec; don't hand-write HTTP calls to the gateway.
- No hard-coded user-facing strings: add Transloco keys in **both Greek and English**. EUR formatting, `el-GR` locale.
- Maps show a circle at the fuzzed location, never a precise pin.

## Testing

- Unit tests (Jest) for domain logic, especially state machines, pricing and refunds.
- Integration tests with **Testcontainers** for anything touching Postgres, RabbitMQ or Redis. No mocks for the outbox/consumer path.
- For each new event: test the publisher writes the outbox row, and the consumer is idempotent (same event twice → one side effect).

## Open decisions — ask, don't pick

These are inconsistent or undecided in the docs. Raise them when they become relevant:
- Location fuzz: ADR-0004 says a random 150–300 m offset; ARCHITECTURE.md says a deterministic ~300 m offset.
- Map tiles: README says OpenStreetMap tiles; ARCHITECTURE.md mentions MapTiler.
- Gateway → service transport: NestJS TCP vs gRPC.
- UI kit: Angular Material vs PrimeNG.

## Stop and ask when

- A change touches money movement, auth/tokens, or personal data handling.
- A migration would drop or rewrite existing data.
- The task conflicts with an ADR or this file.
- You're unsure which service owns something.
