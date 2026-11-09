import type { MigrationInterface, QueryRunner } from 'typeorm';
import { bookingFees } from '@borrowbox/contracts';

/**
 * Checkout (ADR-0019, ADR-0020): each booking's fees, fixed when it was
 * requested, and the pay-by time of an accepted one; which lenders can be
 * paid (from Payments' events); the PAYMENT_TIMEOUT reason and the
 * BOOKING_PAID chat line.
 *
 * Adds columns and widens checks; nothing existing is dropped. Bookings made
 * before this get the fees today's rule gives them, and accepted ones
 * 24 hours to pay from now (or until their start, if sooner).
 */
export class BookingsPayments1762600000000 implements MigrationInterface {
  name = 'BookingsPayments1762600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bookings
        ADD COLUMN fee_cents        integer CHECK (fee_cents >= 0),
        ADD COLUMN lender_fee_cents integer CHECK (lender_fee_cents >= 0),
        -- While ACCEPTED: when it expires unless paid.
        ADD COLUMN pay_by           timestamptz
    `);
    const rows: Array<{
      id: string;
      rent_cents: number;
      deposit_cents: number;
    }> = await queryRunner.query(
      `SELECT id, rent_cents, deposit_cents FROM bookings`,
    );
    for (const row of rows) {
      const fees = bookingFees(row.rent_cents, row.deposit_cents);
      await queryRunner.query(
        `UPDATE bookings SET fee_cents = $2, lender_fee_cents = $3 WHERE id = $1`,
        [row.id, fees.renterFeeCents, fees.lenderFeeCents],
      );
    }
    await queryRunner.query(`
      ALTER TABLE bookings
        ALTER COLUMN fee_cents SET NOT NULL,
        ALTER COLUMN lender_fee_cents SET NOT NULL
    `);
    await queryRunner.query(`
      UPDATE bookings
         SET pay_by = LEAST(now() + interval '24 hours', lower(period))
       WHERE status = 'ACCEPTED'
    `);

    // Mirrors BOOKING_EXPIRE_REASONS & co. in libs/contracts.
    await queryRunner.query(`
      ALTER TABLE bookings
        DROP CONSTRAINT bookings_reason_check,
        ADD CONSTRAINT bookings_reason_check CHECK (reason IN (
          'LENDER', 'OVERLAP', 'RENTER', 'ITEM_DELETED', 'ACCOUNT_DELETED',
          'NO_ANSWER', 'STARTED', 'PAYMENT_TIMEOUT'))
    `);
    await queryRunner.query(`DROP INDEX bookings_accepted_start_idx`);
    // The expiry sweeper's unpaid bookings.
    await queryRunner.query(
      `CREATE INDEX bookings_accepted_pay_by_idx ON bookings (pay_by) WHERE status = 'ACCEPTED'`,
    );

    // Mirrors SYSTEM_MESSAGE_CODES in libs/contracts.
    await queryRunner.query(`
      ALTER TABLE messages
        DROP CONSTRAINT messages_system_code_check,
        ADD CONSTRAINT messages_system_code_check CHECK (system_code IN (
          'BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_CONFIRMED',
          'BOOKING_PAID', 'BOOKING_DECLINED', 'BOOKING_CANCELLED',
          'BOOKING_EXPIRED', 'OFFER_WITHDRAWN'))
    `);

    // Payments' payment.account_ready / .account_restricted: the newest wins.
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN payouts_ready      boolean     NOT NULL DEFAULT false,
        ADD COLUMN payouts_changed_at timestamptz
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN payouts_changed_at, DROP COLUMN payouts_ready`,
    );
    await queryRunner.query(`
      ALTER TABLE messages
        DROP CONSTRAINT messages_system_code_check,
        ADD CONSTRAINT messages_system_code_check CHECK (system_code IN (
          'BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_CONFIRMED',
          'BOOKING_DECLINED', 'BOOKING_CANCELLED', 'BOOKING_EXPIRED',
          'OFFER_WITHDRAWN'))
    `);
    await queryRunner.query(`DROP INDEX bookings_accepted_pay_by_idx`);
    await queryRunner.query(
      `CREATE INDEX bookings_accepted_start_idx ON bookings (lower(period)) WHERE status = 'ACCEPTED'`,
    );
    await queryRunner.query(`
      ALTER TABLE bookings
        DROP CONSTRAINT bookings_reason_check,
        ADD CONSTRAINT bookings_reason_check CHECK (reason IN (
          'LENDER', 'OVERLAP', 'RENTER', 'ITEM_DELETED', 'ACCOUNT_DELETED',
          'NO_ANSWER', 'STARTED'))
    `);
    await queryRunner.query(
      `ALTER TABLE bookings DROP COLUMN pay_by, DROP COLUMN lender_fee_cents, DROP COLUMN fee_cents`,
    );
  }
}
