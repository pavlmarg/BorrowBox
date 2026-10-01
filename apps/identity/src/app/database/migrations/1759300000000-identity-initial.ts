import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Identity's own tables. Unqualified names: the `identity_svc` role's
 * search_path puts them in the `identity` schema (ADR-0002).
 */
export class IdentityInitial1759300000000 implements MigrationInterface {
  name = 'IdentityInitial1759300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        email             text        NOT NULL,
        -- Null for OAuth-only accounts, after an auto-link cleared an
        -- unverified password, and after deletion.
        password_hash     text,
        email_verified_at timestamptz,
        display_name      text,
        locale            text        NOT NULL DEFAULT 'el' CHECK (locale IN ('el', 'en')),
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        -- Set by DELETE /me; the row is kept anonymised (email replaced, name cleared).
        deleted_at        timestamptz,
        CONSTRAINT users_display_name_present
          CHECK (deleted_at IS NOT NULL OR display_name IS NOT NULL)
      )
    `);
    // Emails are compared case-insensitively.
    await queryRunner.query(
      `CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email))`,
    );

    await queryRunner.query(`
      CREATE TABLE oauth_identities (
        provider   text        NOT NULL CHECK (provider IN ('google')),
        -- The provider's stable user id (OIDC "sub"), never the email.
        subject    text        NOT NULL,
        user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (provider, subject)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX oauth_identities_user_id_idx ON oauth_identities (user_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        -- All tokens from one sign-in share a family; reuse revokes the family.
        family_id  uuid        NOT NULL,
        -- SHA-256 of the opaque token; the token itself is never stored.
        token_hash bytea       NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        rotated_at timestamptz,
        revoked_at timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE refresh_tokens`);
    await queryRunner.query(`DROP TABLE oauth_identities`);
    await queryRunner.query(`DROP TABLE users`);
  }
}
