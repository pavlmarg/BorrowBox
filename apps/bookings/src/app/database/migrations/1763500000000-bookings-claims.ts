import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Damage claims (ADR-0028): at most one per booking, filed by the lender
 * while it's RETURNED, answered by the renter, resolved with an award.
 * Adds a table and widens the chat's system codes; nothing is dropped.
 */
export class BookingsClaims1763500000000 implements MigrationInterface {
  name = 'BookingsClaims1763500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE claims (
        booking_id   uuid        PRIMARY KEY REFERENCES bookings (id) ON DELETE CASCADE,
        amount_cents integer     NOT NULL CHECK (amount_cents >= 100),
        -- The lender's text; blanked (null) when their account is erased.
        description  text        CHECK (char_length(description) BETWEEN 10 AND 1000),
        photo_ids    uuid[]      NOT NULL DEFAULT '{}',
        -- Mirrors CLAIM_STATUSES in libs/contracts.
        status       text        NOT NULL DEFAULT 'OPEN' CHECK (status IN (
                                   'OPEN', 'DISAGREED', 'AGREED', 'WITHDRAWN', 'DECIDED')),
        -- The renter's reply; blanked when their account is erased.
        reply        text        CHECK (char_length(reply) BETWEEN 1 AND 500),
        filed_at     timestamptz NOT NULL DEFAULT now(),
        answered_at  timestamptz,
        resolved_at  timestamptz,
        award_cents  integer     CHECK (award_cents >= 0 AND award_cents <= amount_cents),
        CONSTRAINT claims_resolved_has_award CHECK (
          (status IN ('AGREED', 'WITHDRAWN', 'DECIDED'))
            = (resolved_at IS NOT NULL AND award_cents IS NOT NULL))
      )
    `);

    // Mirrors SYSTEM_MESSAGE_CODES in libs/contracts.
    await queryRunner.query(`
      ALTER TABLE messages
        DROP CONSTRAINT messages_system_code_check,
        ADD CONSTRAINT messages_system_code_check CHECK (system_code IN (
          'BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_CONFIRMED',
          'BOOKING_PAID', 'BOOKING_DECLINED', 'BOOKING_CANCELLED',
          'BOOKING_EXPIRED', 'BOOKING_PICKED_UP', 'BOOKING_RETURNED',
          'BOOKING_COMPLETED', 'BOOKING_IN_REVIEW', 'CLAIM_FILED',
          'CLAIM_DISAGREED', 'CLAIM_RESOLVED', 'OFFER_WITHDRAWN'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE messages
        DROP CONSTRAINT messages_system_code_check,
        ADD CONSTRAINT messages_system_code_check CHECK (system_code IN (
          'BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_CONFIRMED',
          'BOOKING_PAID', 'BOOKING_DECLINED', 'BOOKING_CANCELLED',
          'BOOKING_EXPIRED', 'BOOKING_PICKED_UP', 'BOOKING_RETURNED',
          'BOOKING_COMPLETED', 'BOOKING_IN_REVIEW', 'OFFER_WITHDRAWN'))
    `);
    await queryRunner.query(`DROP TABLE claims`);
  }
}
