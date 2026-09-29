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
*   **Object storage:** MinIO locally, Cloudflare R2 / S3 in production
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
*   [ ] **Phase 0 – Foundation:** Nx workspace, Docker Compose (Postgres/PostGIS, RabbitMQ, Redis, MinIO, Mailpit), shared libs, CI
*   [ ] **Phase 1 – Identity & Gateway:** register / login / refresh, profile, Angular auth screens
*   [ ] **Phase 2 – Catalog:** item CRUD, photo upload, geo search + map, fuzzed locations
*   [ ] **Phase 3 – Bookings:** availability, request / accept / decline, state machine, email notifications
*   [ ] **Phase 4 – Payments:** Stripe Connect onboarding, checkout, webhooks, transfers & refunds (test mode)
*   [ ] **Phase 5 – Handoff:** QR pickup/return protocol, condition photos, claim window
*   [ ] **Phase 6 – Trust & Social:** chat, reviews, trust score, ID verification
*   [ ] **Phase 7 – Hardening:** observability stack, e2e tests, GDPR endpoints, VPS deployment

## 🚀 Getting Started (Coming Soon)

Instructions for running the local development environment using Docker Compose will be added here as the microservices are initialized.
