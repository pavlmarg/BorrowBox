# BorrowBox

> Working titles considered: *Daneizo* (from Greek "δανείζω", to lend) / *LendLocal*. **BorrowBox** is the project name used throughout the codebase.

A peer-to-peer rental platform designed to let neighbors borrow infrequently used household items and tools (power drills, ladders, seasonal gear) instead of buying them. Built with a focus on hyper-local community trust and dynamic QR code handoffs.

Launch market: **Greece / EU** (GDPR, PSD2/SCA and DAC7 are considered in the design).

## 🏗 Tech Stack

**Frontend**
*   **Framework:** Angular (Standalone Components, Signals, NgRx SignalStore)
*   **Type:** Progressive Web App (PWA) for mobile camera/QR access
*   **Maps:** MapLibre GL + MapTiler tiles (OpenStreetMap data); item locations are set by dropping a pin, with no address geocoding
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
        *   ~~Publish a `user.profile_updated` event for Notifications' read model (Phase 3).~~ Done in Phase 2 (Catalog needs lender names).
        *   Change / set password in the profile (also for Google-only accounts that want email + password sign-in), confirmed by an email link (Phase 3, needs Notifications).
        *   Email verification and password reset (Phase 3, needs Notifications). Unverified accounts can sign in and browse, but listing, booking and messaging require a verified email. (Until verification exists, Phase 2 lets unverified accounts list items; Phase 3 enforces the rule.)
        *   Terms of Service / Privacy Policy pages, and recorded acceptance at sign-up — including the first Google sign-in that creates an account (GDPR).
        *   Upgrade to NestJS 12 once `@nx/nest` supports it.
*   [ ] **Phase 2 – Catalog:** item CRUD, photo upload, geo search + map, fuzzed locations
    *   Follow-ups:
        *   Identity and Catalog share copied service boilerplate (config, database, events, RPC errors, test harness). Move it into a shared lib when Bookings, the third service, arrives (Phase 3).
        *   A managed Postgres in production needs `CREATE EXTENSION postgis` run by an admin; locally the PostGIS image does it (Phase 7).
        *   Search as you type sends a request per pause in typing: give `catalog.items.suggest`'s gateway endpoint its own, higher rate limit (step 11).
        *   Greek word forms: Postgres' Greek stemmer gives some forms of a word different stems (e.g. "μπαταρίας" vs "μπαταρία"), so typing one full form can miss the other. Partial words match both. Revisit if users notice (e.g. a Greek dictionary or `pg_trgm`).
        *   Suggestions check each typed word per item rather than through the full-text index. Fine for a neighbourhood's items; if it gets slow at scale, build one prefix `tsquery` and use the GIN index.
        *   "More from this lender" on item pages: Phase 6 (Trust), with reviews. Not a people search: names are never searchable.
        *   The production Docker image must use a base image `sharp` ships binaries for (e.g. Debian slim; Alpine needs the musl build) (Phase 7).
        *   Paid extra listing slots (e.g. packs of 5 or 10 beyond the free 10 items): after Phase 4 (Payments), and only after an ADR on pricing, one-off vs subscription, what happens to items over the limit when it ends, refunds and EU VAT.
*   [ ] **Phase 3 – Bookings:** availability, request / accept / decline, state machine, email notifications
*   [ ] **Phase 4 – Payments:** Stripe Connect onboarding, checkout, webhooks, transfers & refunds (test mode)
*   [ ] **Phase 5 – Handoff:** QR pickup/return protocol, condition photos, claim window
*   [ ] **Phase 6 – Trust & Social:** chat, reviews, trust score, ID verification
*   [ ] **Phase 7 – Hardening:** observability stack, e2e tests, VPS deployment

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
| S3 (SeaweedFS) | http://localhost:8333: private `borrowbox-uploads` and public-read `borrowbox-public` buckets, created by the one-shot `storage-init` container (see `infra/storage`) |
| Mailpit | SMTP `localhost:1025`, UI http://localhost:8025 |

Ports can be changed in `infra/.env` if they clash with something already running.

> **Upgrading an existing `infra/.env`** (Phase 2): the single `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET` were replaced by admin and catalog keys and two buckets. Copy the `S3_*` block from `infra/.env.example`, then run `docker compose -f infra/docker-compose.yml up -d --wait` again.

### Running the apps

```sh
# 1. Config for each app (gitignored). Use the passwords from infra/.env.
cp apps/identity/.env.example apps/identity/.env
cp apps/catalog/.env.example apps/catalog/.env
cp apps/gateway/.env.example apps/gateway/.env

# 2. Token signing keys: paste all three lines into apps/identity/.env, and
#    only JWT_KEY_ID + JWT_PUBLIC_KEY into apps/catalog/.env and apps/gateway/.env.
node tools/gen-jwt-keys.mjs

# 3. Set COOKIE_SECRET in apps/gateway/.env (32+ random characters):
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 4. Start them (one terminal each)
npx nx serve identity   # TCP :4001, runs DB migrations in dev
npx nx serve catalog    # TCP :4002, runs DB migrations in dev; needs Redis + SeaweedFS (photo pipeline)
npx nx serve gateway    # http://localhost:3000/api (Swagger UI at /api/docs)
npx nx serve web        # http://localhost:4200 (proxies /api to the gateway)
```

Google sign-in is optional. To enable it, create a "Web application" OAuth client in Google Cloud Console
with redirect URI `http://localhost:4200/api/auth/google/callback`. Put `GOOGLE_CLIENT_ID` in both `.env`
files and `GOOGLE_CLIENT_SECRET` in Identity's only. Left empty, Google sign-in stays disabled.

Tests never read these `.env` files (`NODE_ENV=test`); they set their own environment.

Catalog learns display names from Identity's `user.*` events, and RabbitMQ only delivers to queues that already
exist. Accounts registered before Catalog first ran are therefore unknown to it, and their items won't show
publicly. To fix such a local account, change its display name once in Settings.

After changing gateway endpoints, run `npx nx run gateway:openapi` and then `npx nx run web:api-client` to
regenerate the spec and the PWA's typed client.

**Shared libraries** (`libs/`):
`contracts` (event envelope, versioned event types, RPC contracts, shared input rules), `auth` (Ed25519 access
tokens, JWT guards), `messaging` (RabbitMQ bus with retry queues and DLQ), `outbox` (transactional outbox,
relay, idempotent consumers on TypeORM) and `testing` (Testcontainers helpers).
