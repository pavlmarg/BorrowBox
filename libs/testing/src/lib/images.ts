// Keep in sync with infra/docker-compose.yml so tests run against the same versions as dev.
export const POSTGRES_IMAGE = 'postgis/postgis:17-3.5';
export const RABBITMQ_IMAGE = 'rabbitmq:4.3-management-alpine';
export const REDIS_IMAGE = 'redis:8.10-alpine';

// Generous: several test files may boot containers in parallel (CI runners, laptops).
export const STARTUP_TIMEOUT_MS = 120_000;
