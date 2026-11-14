import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lenders' public profile photos (ADR-0024), kept from
 * `user.profile_updated` like their names: `{ small, large }` URLs, or null.
 */
export class CatalogLenderPhotos1763100000000 implements MigrationInterface {
  name = 'CatalogLenderPhotos1763100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE lenders ADD COLUMN photo jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE lenders DROP COLUMN photo`);
  }
}
