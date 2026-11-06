import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notifications' schema (ADR-0016): who to email (from Identity's events)
 * and the emails to send. Kinds mirror libs/contracts' EMAIL_KINDS.
 */
export class NotificationsInitial1761500000000 implements MigrationInterface {
  name = 'NotificationsInitial1761500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The email may arrive after the name (user.profile_updated first).
    // Deletion is final: the row keeps only the id.
    await queryRunner.query(`
      CREATE TABLE recipients (
        user_id         uuid        PRIMARY KEY,
        email           text,
        display_name    text,
        locale          text        CHECK (locale IN ('el', 'en')),
        -- occurredAt of the newest user.* event applied.
        updated_at      timestamptz NOT NULL,
        deleted_at      timestamptz,
        CONSTRAINT recipients_deleted_forgotten CHECK (
          deleted_at IS NULL
          OR (email IS NULL AND display_name IS NULL AND locale IS NULL))
      )
    `);

    // One row per email. `data` holds what the template needs (item title,
    // period, amounts, the other person's id), never message text; the email
    // is rendered when sent, in the recipient's language then.
    await queryRunner.query(`
      CREATE TABLE email_jobs (
        id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        kind            text        NOT NULL CHECK (kind IN (
          'BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_CONFIRMED',
          'BOOKING_DECLINED', 'BOOKING_EXPIRED', 'BOOKING_CANCELLED',
          'OFFER_RECEIVED', 'OFFER_BOOKED', 'MESSAGES_UNREAD')),
        recipient_id    uuid        NOT NULL,
        data            jsonb       NOT NULL,
        status          text        NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'SENT', 'DROPPED')),
        attempts        integer     NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        created_at      timestamptz NOT NULL DEFAULT now(),
        sent_at         timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX email_jobs_due_idx ON email_jobs (next_attempt_at) WHERE status = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE INDEX email_jobs_recipient_idx ON email_jobs (recipient_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE email_jobs`);
    await queryRunner.query(`DROP TABLE recipients`);
  }
}
