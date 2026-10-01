# ADR-0005: NestJS TCP transport between the gateway and services

**Status:** Accepted

## Context
The gateway calls services synchronously, and only for queries and user-initiated commands (ARCHITECTURE.md §2). The docs left the transport open: NestJS TCP or gRPC. Every service is TypeScript in one Nx monorepo, and request/response types already live in `libs/contracts`.

## Decision
Use the **NestJS TCP transport** (`@nestjs/microservices`, `Transport.TCP`) for gateway → service calls.
- Message patterns and request/response DTO types are defined in `libs/contracts` next to the event types, e.g. `identity.register`.
- The gateway never uses `ClientProxy` directly in controllers. Each service has a typed client wrapper (e.g. `IdentityClient`), so the transport can be swapped later without touching controllers.
- The caller's access token travels with each request, so services can re-verify it (defence in depth, ARCHITECTURE.md §8).

## Consequences
- There is no extra tooling (`protoc`, codegen), and contracts are checked at compile time because both sides import the same TypeScript types.
- TCP messages are JSON with no schema enforcement at runtime. Services must validate incoming payloads with `class-validator` like any other input.
- Plain TCP is neither encrypted nor authenticated. That's fine on a private Docker network, but it has to be revisited before services span hosts, either with gRPC + TLS or with TLS options on the TCP transport.
- Moving to gRPC later means changing the client wrappers and the service bootstrap, not business code.
