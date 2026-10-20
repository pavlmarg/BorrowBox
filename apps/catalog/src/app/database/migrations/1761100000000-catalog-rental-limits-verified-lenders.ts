import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3: an item's shortest and longest booking (ADR-0015), and which
 * lenders have a verified email (from `user.email_verified`), which
 * publishing needs.
 *
 * Limits are literals on purpose (see CatalogInitial): 1 hour to 90 days,
 * mirroring BOOKING_MIN_HOURS / BOOKING_MAX_HOURS in libs/contracts.
 */
export class CatalogRentalLimitsVerifiedLenders1761100000000
  implements MigrationInterface
{
  name = 'CatalogRentalLimitsVerifiedLenders1761100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE items
        ADD COLUMN min_rental_hours integer
          CHECK (min_rental_hours BETWEEN 1 AND 2160),
        ADD COLUMN max_rental_hours integer
          CHECK (max_rental_hours BETWEEN 1 AND 2160),
        ADD CONSTRAINT items_rental_limits_order
          CHECK (min_rental_hours <= max_rental_hours)
    `);

    // Separate from lenders: the event may arrive before the lender's name.
    // Rows are removed when the account is deleted.
    await queryRunner.query(`
      CREATE TABLE verified_lenders (
        user_id     uuid        PRIMARY KEY,
        -- occurredAt of the user.email_verified event.
        verified_at timestamptz NOT NULL
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE verified_lenders`);
    await queryRunner.query(`
      ALTER TABLE items
        DROP CONSTRAINT items_rental_limits_order,
        DROP COLUMN max_rental_hours,
        DROP COLUMN min_rental_hours
    `);
  }
}
