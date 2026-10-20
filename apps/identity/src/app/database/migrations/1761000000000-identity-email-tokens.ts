import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time tokens for email links (ADR-0016): email verification and
 * password reset. Only their SHA-256 hash is stored. A new link replaces the
 * account's older ones of the same kind, so there is at most one row per
 * account and kind.
 */
export class IdentityEmailTokens1761000000000 implements MigrationInterface {
  name = 'IdentityEmailTokens1761000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE email_tokens (
        id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        kind       text        NOT NULL CHECK (kind IN ('VERIFY_EMAIL', 'RESET_PASSWORD')),
        token_hash bytea       NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        used_at    timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX email_tokens_user_kind_idx ON email_tokens (user_id, kind)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE email_tokens`);
  }
}
