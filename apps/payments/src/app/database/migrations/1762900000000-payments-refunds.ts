import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refunds and settlement (ADR-0021, PR C): every refund and transfer is one
 * `money_movements` row, planned in the same transaction as the event that
 * caused it and carried out by the worker. A payment's planned refunds and
 * transfers can never add up to more than it charged (a CHECK, not just
 * code).
 *
 * Lists are literals on purpose: they mirror libs/contracts as it was when
 * this ran.
 */
export class PaymentsRefunds1762900000000 implements MigrationInterface {
  name = 'PaymentsRefunds1762900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments
        -- The charge transfers are paid from (source_transaction).
        ADD COLUMN stripe_charge_id  text,
        -- Planned so far, in cents; never more than the charge together.
        ADD COLUMN refunded_cents    integer NOT NULL DEFAULT 0,
        ADD COLUMN transferred_cents integer NOT NULL DEFAULT 0,
        ADD CONSTRAINT payments_movements_within_charge CHECK (
          refunded_cents >= 0 AND transferred_cents >= 0
          AND refunded_cents + transferred_cents <= amount_cents),
        DROP CONSTRAINT payments_status_check,
        ADD CONSTRAINT payments_status_check CHECK (status IN (
          'REQUIRES_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'CANCELLED',
          'NEEDS_REFUND', 'REFUNDED', 'SETTLED'))
    `);

    await queryRunner.query(`
      ALTER TABLE bookings
        ADD COLUMN start_at       timestamptz,
        -- The close: when (the event's time), why, and whose erasure.
        ADD COLUMN closed_at      timestamptz,
        ADD COLUMN close_reason   text,
        ADD COLUMN erased_user_id uuid,
        -- booking.paid was seen: a cancellation then follows the refund
        -- rules; otherwise the payment counts as having come too late.
        ADD COLUMN was_paid       boolean NOT NULL DEFAULT false,
        DROP CONSTRAINT bookings_status_check,
        ADD CONSTRAINT bookings_status_check CHECK (status IN (
          'AWAITING_PAYMENT', 'PAID', 'DISPUTED', 'COMPLETED', 'CLOSED'))
    `);

    await queryRunner.query(`
      CREATE TABLE money_movements (
        id               uuid        PRIMARY KEY,
        payment_id       uuid        NOT NULL REFERENCES payments (id),
        booking_id       uuid        NOT NULL,
        kind             text        NOT NULL CHECK (kind IN ('REFUND', 'TRANSFER')),
        purpose          text        NOT NULL CHECK (purpose IN (
                                       'CANCELLATION', 'LATE_PAYMENT', 'DEPOSIT', 'RENT')),
        amount_cents     integer     NOT NULL CHECK (amount_cents > 0),
        -- The renter for refunds, the lender for transfers.
        recipient_id     uuid        NOT NULL,
        status           text        NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING', 'SUBMITTED', 'SUCCEEDED', 'FAILED')),
        stripe_object_id text        UNIQUE,
        attempts         integer     NOT NULL DEFAULT 0,
        next_attempt_at  timestamptz NOT NULL DEFAULT now(),
        created_at       timestamptz NOT NULL DEFAULT now(),
        done_at          timestamptz,
        -- One of each per payment: planning twice can't move money twice.
        CONSTRAINT money_movements_once UNIQUE (payment_id, purpose),
        CONSTRAINT money_movements_kind_fits CHECK (
          (kind = 'TRANSFER') = (purpose = 'RENT'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX money_movements_due_idx ON money_movements (next_attempt_at)
        WHERE status = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE INDEX money_movements_recipient_idx ON money_movements (recipient_id, created_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE money_movements`);
    await queryRunner.query(`
      ALTER TABLE bookings
        DROP CONSTRAINT bookings_status_check,
        ADD CONSTRAINT bookings_status_check CHECK (status IN (
          'AWAITING_PAYMENT', 'PAID', 'CLOSED')),
        DROP COLUMN was_paid, DROP COLUMN erased_user_id,
        DROP COLUMN close_reason, DROP COLUMN closed_at, DROP COLUMN start_at
    `);
    await queryRunner.query(`
      ALTER TABLE payments
        DROP CONSTRAINT payments_status_check,
        ADD CONSTRAINT payments_status_check CHECK (status IN (
          'REQUIRES_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'CANCELLED',
          'NEEDS_REFUND')),
        DROP CONSTRAINT payments_movements_within_charge,
        DROP COLUMN transferred_cents, DROP COLUMN refunded_cents,
        DROP COLUMN stripe_charge_id
    `);
  }
}
