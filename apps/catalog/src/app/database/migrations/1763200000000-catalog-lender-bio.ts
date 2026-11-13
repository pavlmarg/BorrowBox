import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lenders' public bios (ADR-0025), kept from `user.profile_updated` like
 * their names and photos; null for none. Shown on their item pages.
 */
export class CatalogLenderBio1763200000000 implements MigrationInterface {
  name = 'CatalogLenderBio1763200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE lenders ADD COLUMN bio text`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE lenders DROP COLUMN bio`);
  }
}
