import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The public bio (ADR-0025): null for none, else 1–150 characters
 * (`BIO_MAX_LENGTH`; `char_length` counts characters, like the shared rule).
 * Erasure sets it back to null.
 */
export class IdentityBio1763200000000 implements MigrationInterface {
  name = 'IdentityBio1763200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN bio text
        CONSTRAINT users_bio_length CHECK (char_length(bio) BETWEEN 1 AND 150)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN bio`);
  }
}
