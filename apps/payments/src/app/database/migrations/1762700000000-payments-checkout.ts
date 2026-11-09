import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Checkout (ADR-0019, ADR-0020, PR B): the bookings Payments takes money
 * for (a read model of `booking.*` events), one payment per booking, and
 * the object each stored Stripe event is about.
 *
 * Lists are literals on purpose: they mirror libs/contracts' payments.ts
 * as it was when this ran.
 */
export class PaymentsCheckout1762700000000 implements MigrationInterface {
  name = 'PaymentsCheckout1762700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Bookings waiting for payment, paid or closed. Events may arrive out of
    // order: a closed booking stays closed, a paid one never waits again.
    await queryRunner.query(`
      CREATE TABLE bookings (
        booking_id       uuid        PRIMARY KEY,
        renter_id        uuid        NOT NULL,
        lender_id        uuid        NOT NULL,
        item_title       text        NOT NULL,
        rent_cents       integer     NOT NULL CHECK (rent_cents >= 0),
        deposit_cents    integer     NOT NULL CHECK (deposit_cents >= 0),
        fee_cents        integer     NOT NULL CHECK (fee_cents >= 0),
        lender_fee_cents integer     NOT NULL CHECK (lender_fee_cents >= 0),
        pay_by           timestamptz,
        status           text        NOT NULL
                         CHECK (status IN ('AWAITING_PAYMENT', 'PAID', 'CLOSED')),
        updated_at       timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Amounts are copied from the booking when paying starts, in cents.
    // The PaymentIntent's client secret is never stored.
    await queryRunner.query(`
      CREATE TABLE payments (
        id                        uuid        PRIMARY KEY,
        booking_id                uuid        NOT NULL UNIQUE,
        renter_id                 uuid        NOT NULL,
        rent_cents                integer     NOT NULL CHECK (rent_cents >= 0),
        deposit_cents             integer     NOT NULL CHECK (deposit_cents >= 0),
        fee_cents                 integer     NOT NULL CHECK (fee_cents >= 0),
        lender_fee_cents          integer     NOT NULL CHECK (lender_fee_cents >= 0),
        amount_cents              integer     NOT NULL CHECK (amount_cents >= 50),
        stripe_payment_intent_id  text        UNIQUE,
        status                    text        NOT NULL DEFAULT 'REQUIRES_PAYMENT'
                                  CHECK (status IN ('REQUIRES_PAYMENT', 'PROCESSING',
                                    'SUCCEEDED', 'CANCELLED', 'NEEDS_REFUND')),
        last_attempt_failed       boolean     NOT NULL DEFAULT false,
        created_at                timestamptz NOT NULL DEFAULT now(),
        paid_at                   timestamptz,
        -- The booking closed before it was paid: the PaymentIntent is
        -- cancelled at Stripe by the worker, retried with backoff.
        stripe_cancel_pending     boolean     NOT NULL DEFAULT false,
        stripe_cancel_attempts    integer     NOT NULL DEFAULT 0,
        next_stripe_cancel_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT payments_amount_adds_up
          CHECK (amount_cents = rent_cents + deposit_cents + fee_cents)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX payments_renter_idx ON payments (renter_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX payments_cancel_due_idx ON payments (next_stripe_cancel_at)
        WHERE stripe_cancel_pending`,
    );

    // What a stored Stripe event is about (the PaymentIntent, the account).
    await queryRunner.query(
      `ALTER TABLE stripe_events ADD COLUMN object_id text`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE stripe_events DROP COLUMN object_id`);
    await queryRunner.query(`DROP TABLE payments`);
    await queryRunner.query(`DROP TABLE bookings`);
  }
}
