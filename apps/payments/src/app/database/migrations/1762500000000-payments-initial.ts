import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payments' first tables (ADR-0019, PR A): lenders' Stripe connected
 * accounts, the Stripe events received, and who has a verified email.
 * Payments, transfers and refunds come with checkout and settlement.
 */
export class PaymentsInitial1762500000000 implements MigrationInterface {
  name = 'PaymentsInitial1762500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // One per lender. The row is written before Stripe is called, so a
    // retried onboarding finds it and reuses its Stripe idempotency key.
    // The flags mirror Stripe's account as last fetched (A3); `ready` is
    // what Payments last announced (payment.account_ready / _restricted).
    await queryRunner.query(`
      CREATE TABLE connected_accounts (
        id                 uuid        PRIMARY KEY,
        user_id            uuid        NOT NULL UNIQUE,
        stripe_account_id  text        UNIQUE,
        details_submitted  boolean     NOT NULL DEFAULT false,
        transfers_active   boolean     NOT NULL DEFAULT false,
        payouts_enabled    boolean     NOT NULL DEFAULT false,
        -- Stripe gave a reason for disabling the account.
        disabled           boolean     NOT NULL DEFAULT false,
        ready              boolean     NOT NULL DEFAULT false,
        created_at         timestamptz NOT NULL DEFAULT now(),
        -- When the flags were last fetched from Stripe.
        synced_at          timestamptz,
        -- Account erasure (A7): Stripe's account is deleted by a worker,
        -- retried until it succeeds. The row stays (P12).
        deleted_at         timestamptz,
        stripe_deleted_at  timestamptz,
        deletion_attempts  integer     NOT NULL DEFAULT 0,
        next_deletion_at   timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX connected_accounts_deletion_due_idx ON connected_accounts (next_deletion_at)
        WHERE deleted_at IS NOT NULL AND stripe_deleted_at IS NULL`,
    );

    // Webhooks (A3): only what identifies the event, never its payload.
    // The worker fetches the current object from Stripe when processing.
    await queryRunner.query(`
      CREATE TABLE stripe_events (
        event_id        text        PRIMARY KEY,
        type            text        NOT NULL,
        source          text        NOT NULL CHECK (source IN ('platform', 'connect')),
        -- The connected account it's about (Connect events), if any.
        account_id      text,
        received_at     timestamptz NOT NULL DEFAULT now(),
        processed_at    timestamptz,
        attempts        integer     NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX stripe_events_due_idx ON stripe_events (next_attempt_at)
        WHERE processed_at IS NULL`,
    );

    // From Identity's events (A6). Deletion is final.
    await queryRunner.query(`
      CREATE TABLE verified_users (
        user_id           uuid        PRIMARY KEY,
        email_verified_at timestamptz,
        deleted_at        timestamptz
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE verified_users`);
    await queryRunner.query(`DROP TABLE stripe_events`);
    await queryRunner.query(`DROP TABLE connected_accounts`);
  }
}
