# BorrowBox

> Working titles considered: *Daneizo* (from Greek "δανείζω", to lend) / *LendLocal*. **BorrowBox** is the project name used throughout the codebase.

A peer-to-peer rental platform designed to let neighbors borrow infrequently used household items and tools (power drills, ladders, seasonal gear) instead of buying them. Built with a focus on hyper-local community trust and dynamic QR code handoffs.

Launch market: **Greece / EU** (GDPR, PSD2/SCA and DAC7 are considered in the design).

## 🏗 Tech Stack

**Frontend**
*   **Framework:** Angular (Standalone Components, Signals, NgRx SignalStore)
*   **Type:** Progressive Web App (PWA) for mobile camera/QR access
*   **Maps:** MapLibre GL + OpenStreetMap tiles, Nominatim/Photon geocoding
*   **i18n:** Greek & English

**Backend (Event-Driven Microservices)**
*   **Framework:** NestJS in an **Nx monorepo**
*   **Messaging:** RabbitMQ (asynchronous events, transactional outbox)
*   **Database:** PostgreSQL with **PostGIS** (one schema per service)
*   **Caching / Real-time / Jobs:** Redis (Socket.IO adapter, pub/sub, BullMQ delayed jobs)
*   **Object storage:** SeaweedFS (S3-compatible) locally, Cloudflare R2 in production
*   **Payments:** Stripe Connect Express (separate charges & transfers, refundable deposits)
*   **Identity verification:** Stripe Identity
*   **Observability:** OpenTelemetry, Grafana / Loki / Tempo / Prometheus

## 🏛 System Architecture

The backend runs as event-driven microservices behind a single API gateway. Services own their data and communicate asynchronously through RabbitMQ, so a failure in one service doesn't cascade to the others.

| Service | Responsibility |
|---|---|
| **API Gateway (BFF)** | Single public entry point: JWT validation, rate limiting, response aggregation, WebSocket hub |
| **Identity** | Accounts, auth (JWT + rotating refresh tokens), profiles, ID verification, GDPR export/delete |
| **Catalog** | Items, photos, pricing & deposits, geospatial + full-text search, location fuzzing |
| **Bookings** | Availability, booking state machine, QR handoff tokens, condition photos |
| **Payments** | Stripe Connect onboarding, payments, transfers, deposit refunds/claims, webhooks |
| **Messaging** | Per-booking renter ↔ lender chat |
| **Notifications** | Email, Web Push, in-app notifications (event consumer only) |
| **Reviews / Trust** | Two-sided reviews and trust score |

📐 Full design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Key decisions are recorded in [`docs/adr/`](docs/adr).

## 🗺 Roadmap

*   [x] System architecture defined
*   [x] **Phase 0 – Foundation:** Nx workspace, Docker Compose (Postgres/PostGIS, RabbitMQ, Redis, SeaweedFS, Mailpit), shared libs, CI
*   [x] **Phase 1 – Identity & Gateway:** register / login / refresh, Google sign-in, profile, GDPR export & deletion, Angular auth screens
    *   Follow-ups:
        *   Publish a `user.profile_updated` event for Notifications' read model (Phase 3).
        *   A "set password" flow for accounts whose password was cleared by Google auto-linking.
        *   Email verification and password reset, once email sending exists (Notifications).
        *   Upgrade to NestJS 12 once `@nx/nest` supports it.
*   [ ] **Phase 2 – Catalog:** item CRUD, photo upload, geo search + map, fuzzed locations
*   [ ] **Phase 3 – Bookings:** availability, request / accept / decline, state machine, email notifications
*   [ ] **Phase 4 – Payments:** Stripe Connect onboarding, checkout, webhooks, transfers & refunds (test mode)
*   [ ] **Phase 5 – Handoff:** QR pickup/return protocol, condition photos, claim window
*   [ ] **Phase 6 – Trust & Social:** chat, reviews, trust score, ID verification
*   [ ] **Phase 7 – Hardening:** observability stack, e2e tests, GDPR endpoints, VPS deployment

## 🚀 Getting Started

**Prerequisites:** Node.js 22.22.3 or newer 22.x (see `.nvmrc`; Angular 22 and Testcontainers need it), Docker (Docker Desktop on Windows/macOS).

```sh
npm ci

# Local infrastructure: Postgres+PostGIS, RabbitMQ, Redis, SeaweedFS (S3), Mailpit
cp infra/.env.example infra/.env      # then change the passwords
docker compose -f infra/docker-compose.yml up -d --wait

# Lint, test and build what changed (integration tests start their own containers)
npx nx affected -t lint test build
```

| Service | Default address |
|---|---|
| Postgres | `localhost:5432` (one role + schema per service, see `infra/postgres/init`) |
| RabbitMQ | `localhost:5672`, management UI http://localhost:15672 |
| Redis | `localhost:6379` |
| S3 (SeaweedFS) | http://localhost:8333 |
| Mailpit | SMTP `localhost:1025`, UI http://localhost:8025 |

Ports can be changed in `infra/.env` if they clash with something already running.

### Running the apps

```sh
# 1. Config for each app (gitignored). Use the passwords from infra/.env.
cp apps/identity/.env.example apps/identity/.env
cp apps/gateway/.env.example apps/gateway/.env

# 2. Token signing keys: paste all three lines into apps/identity/.env, and
#    only JWT_KEY_ID + JWT_PUBLIC_KEY into apps/gateway/.env.
node tools/gen-jwt-keys.mjs

# 3. Set COOKIE_SECRET in apps/gateway/.env (32+ random characters):
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 4. Start them (three terminals)
npx nx serve identity   # TCP :4001, runs DB migrations in dev
npx nx serve gateway    # http://localhost:3000/api (Swagger UI at /api/docs)
npx nx serve web        # http://localhost:4200 (proxies /api to the gateway)
```

Google sign-in is optional. To enable it, create a "Web application" OAuth client in Google Cloud Console
with redirect URI `http://localhost:4200/api/auth/google/callback`. Put `GOOGLE_CLIENT_ID` in both `.env`
files and `GOOGLE_CLIENT_SECRET` in Identity's only.

After changing gateway endpoints, run `npx nx run gateway:openapi` and then `npx nx run web:api-client` to
regenerate the spec and the PWA's typed client.

**Shared libraries** (`libs/`):
`contracts` (event envelope, versioned event types, RPC contracts, shared input rules), `auth` (Ed25519 access
tokens, JWT guards), `messaging` (RabbitMQ bus with retry queues and DLQ), `outbox` (transactional outbox,
relay, idempotent consumers on TypeORM) and `testing` (Testcontainers helpers).
