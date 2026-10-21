import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3: which items get booked, from Bookings' `booking.accepted` and
 * `booking.confirmed`, so Explore's featured items are the most booked
 * nearby. One row per booking (idempotent), no people; rows older than
 * 90 days are pruned.
 */
export class CatalogItemBookings1761300000000 implements MigrationInterface {
  name = 'CatalogItemBookings1761300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE item_bookings (
        booking_id uuid        PRIMARY KEY,
        item_id    uuid        NOT NULL,
        -- occurredAt of the event: when the booking was accepted.
        booked_at  timestamptz NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX item_bookings_item_idx ON item_bookings (item_id, booked_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE item_bookings`);
  }
}
