# @borrowbox/testing

Test-only helpers. Import from `*.spec.ts` files only.

- `startPostgres()` — PostGIS container initialised with the real
  `infra/postgres/init` script, so tests use the same per-service roles and
  schema isolation as local dev. Use `urlFor('<service>')` for code under test
  and `adminUrl` only for setup/assertions.
- `startRabbitMq()` — RabbitMQ container, returns the AMQP URL.

Requires a running Docker daemon (Docker Desktop locally; available on GitHub
Actions Ubuntu runners). Image versions match `infra/docker-compose.yml`.
