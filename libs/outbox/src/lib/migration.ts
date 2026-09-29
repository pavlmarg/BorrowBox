import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `outbox` and `processed_events` in the service's own schema.
 * Table names are unqualified on purpose: each service's DB role has
 * `search_path = <its schema>, public` (infra/postgres/init), so every service
 * gets its own `<schema>.outbox` / `<schema>.processed_events`.
 *
 * Add this class to the service DataSource's `migrations` list.
 */
export class CreateOutboxTables1759140000000 implements MigrationInterface {
  name = 'CreateOutboxTables1759140000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE outbox (
        id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        event_id     uuid        NOT NULL UNIQUE,
        routing_key  text        NOT NULL,
        envelope     jsonb       NOT NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz,
        attempts     integer     NOT NULL DEFAULT 0,
        last_error   text
      )
    `);
    // The relay only ever scans unpublished rows, in insertion order.
    await queryRunner.query(`
      CREATE INDEX outbox_unpublished_idx ON outbox (id) WHERE published_at IS NULL
    `);
    await queryRunner.query(`
      CREATE TABLE processed_events (
        consumer     text        NOT NULL,
        event_id     uuid        NOT NULL,
        processed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (consumer, event_id)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE processed_events`);
    await queryRunner.query(`DROP TABLE outbox`);
  }
}
