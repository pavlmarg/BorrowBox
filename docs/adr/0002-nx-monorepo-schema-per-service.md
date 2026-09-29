# ADR-0002: Nx monorepo with one Postgres schema per service

**Status:** Accepted

## Context
Microservices are a core learning goal, but a solo developer can't afford separate repos, pipelines and databases for each service.

## Decision
- One **Nx monorepo** holds the Angular app, all NestJS services and the shared libs (`contracts`, `auth`, `outbox`, …).
- One **PostgreSQL instance** with **one schema and one DB role per service**. Each role can only access its own schema.
- Services are introduced in phases. Messaging and Reviews may start as modules inside Bookings.

## Consequences
- Shared TypeScript contracts catch breaking changes at compile time, and `nx affected` keeps CI fast.
- Data ownership is enforced by DB permissions without running many databases. A schema can move to its own instance later with no code changes.
- A single Postgres instance is a shared point of failure. That's acceptable at this stage.
