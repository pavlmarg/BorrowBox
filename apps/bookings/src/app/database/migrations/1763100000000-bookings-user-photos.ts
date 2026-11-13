import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * People's public profile photos (ADR-0024), kept from
 * `user.profile_updated` like their names: `{ small, large }` URLs, or null.
 * Shown in chat and on bookings next to the name.
 */
export class BookingsUserPhotos1763100000000 implements MigrationInterface {
  name = 'BookingsUserPhotos1763100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN photo jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN photo`);
  }
}
