import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Handoffs (ARCHITECTURE.md §5, ADR-0026): when a booking was picked up and
 * returned, its claim window, the "did it happen?" rounds when nobody
 * scanned, the two people's answers, and a review flag for an admin.
 *
 * Adds columns and tables and widens checks; nothing existing is dropped.
 * Bookings already going ahead (PAID, CONFIRMED) join the timeline now:
 * their first check is due 2 hours after their start, or now if that passed.
 */
export class BookingsHandoff1763300000000 implements MigrationInterface {
  name = 'BookingsHandoff1763300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bookings
        ADD COLUMN picked_up_at   timestamptz,
        ADD COLUMN returned_at    timestamptz,
        -- While RETURNED: until when the lender can file a damage claim.
        ADD COLUMN claim_until    timestamptz,
        -- When the handoff timeline next looks at the booking (a round of
        -- questions, the outcome, or the end of the claim window).
        ADD COLUMN handoff_due_at timestamptz,
        -- "Did it happen?" rounds sent for the current handoff (0–3).
        ADD COLUMN handoff_rounds smallint NOT NULL DEFAULT 0
                   CHECK (handoff_rounds BETWEEN 0 AND 3),
        -- Mirrors BOOKING_REVIEW_REASONS in libs/contracts.
        ADD COLUMN review_reason  text CHECK (review_reason IN (
                   'PICKUP_UNCONFIRMED', 'RETURN_UNCONFIRMED'))
    `);
    await queryRunner.query(`
      UPDATE bookings
         SET handoff_due_at = GREATEST(lower(period) + interval '2 hours', now())
       WHERE status IN ('PAID', 'CONFIRMED')
    `);
    // The sweeper's due handoff checks.
    await queryRunner.query(
      `CREATE INDEX bookings_handoff_due_idx ON bookings (handoff_due_at) WHERE handoff_due_at IS NOT NULL`,
    );

    // Mirrors BOOKING_EXPIRE_REASONS & co. in libs/contracts.
    await queryRunner.query(`
      ALTER TABLE bookings
        DROP CONSTRAINT bookings_reason_check,
        ADD CONSTRAINT bookings_reason_check CHECK (reason IN (
          'LENDER', 'OVERLAP', 'RENTER', 'ITEM_DELETED', 'ACCOUNT_DELETED',
          'NO_ANSWER', 'STARTED', 'PAYMENT_TIMEOUT', 'NO_HANDOFF'))
    `);

    // How each pickup and return was recorded; one row per booking and phase.
    await queryRunner.query(`
      CREATE TABLE handoffs (
        booking_id uuid        NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
        phase      text        NOT NULL CHECK (phase IN ('PICKUP', 'RETURN')),
        method     text        NOT NULL CHECK (method IN (
                               'QR', 'CODE', 'CONFIRMED', 'ADMIN', 'RETURN_SCAN')),
        -- Who showed and who scanned the code; null when not scanned.
        shown_by   uuid,
        scanned_by uuid,
        at         timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (booking_id, phase)
      )
    `);

    // "Did the handoff happen?" (ADR-0026). Final once given.
    await queryRunner.query(`
      CREATE TABLE handoff_answers (
        booking_id  uuid        NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
        phase       text        NOT NULL CHECK (phase IN ('PICKUP', 'RETURN')),
        user_id     uuid        NOT NULL,
        answer      text        NOT NULL CHECK (answer IN ('YES', 'NO')),
        answered_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (booking_id, phase, user_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX handoff_answers_user_idx ON handoff_answers (user_id)`,
    );

    // Mirrors SYSTEM_MESSAGE_CODES in libs/contracts.
    await queryRunner.query(`
      ALTER TABLE messages
        DROP CONSTRAINT messages_system_code_check,
        ADD CONSTRAINT messages_system_code_check CHECK (system_code IN (
          'BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_CONFIRMED',
          'BOOKING_PAID', 'BOOKING_DECLINED', 'BOOKING_CANCELLED',
          'BOOKING_EXPIRED', 'BOOKING_PICKED_UP', 'BOOKING_RETURNED',
          'BOOKING_COMPLETED', 'BOOKING_IN_REVIEW', 'OFFER_WITHDRAWN'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE messages
        DROP CONSTRAINT messages_system_code_check,
        ADD CONSTRAINT messages_system_code_check CHECK (system_code IN (
          'BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_CONFIRMED',
          'BOOKING_PAID', 'BOOKING_DECLINED', 'BOOKING_CANCELLED',
          'BOOKING_EXPIRED', 'OFFER_WITHDRAWN'))
    `);
    await queryRunner.query(`DROP TABLE handoff_answers`);
    await queryRunner.query(`DROP TABLE handoffs`);
    await queryRunner.query(`
      ALTER TABLE bookings
        DROP CONSTRAINT bookings_reason_check,
        ADD CONSTRAINT bookings_reason_check CHECK (reason IN (
          'LENDER', 'OVERLAP', 'RENTER', 'ITEM_DELETED', 'ACCOUNT_DELETED',
          'NO_ANSWER', 'STARTED', 'PAYMENT_TIMEOUT'))
    `);
    await queryRunner.query(`DROP INDEX bookings_handoff_due_idx`);
    await queryRunner.query(`
      ALTER TABLE bookings
        DROP COLUMN review_reason, DROP COLUMN handoff_rounds,
        DROP COLUMN handoff_due_at, DROP COLUMN claim_until,
        DROP COLUMN returned_at, DROP COLUMN picked_up_at
    `);
  }
}
