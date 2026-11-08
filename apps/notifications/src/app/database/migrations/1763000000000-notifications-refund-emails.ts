import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Refunds and settlement's emails (ADR-0021): a refund is on its way, the
 * deposit comes back, the lender was paid. Widens the kinds email jobs may
 * have; the list mirrors EMAIL_KINDS in libs/contracts.
 */
export class NotificationsRefundEmails1763000000000 implements MigrationInterface {
  name = 'NotificationsRefundEmails1763000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE email_jobs
        DROP CONSTRAINT email_jobs_kind_check,
        ADD CONSTRAINT email_jobs_kind_check CHECK (kind IN (
          'BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_CONFIRMED',
          'BOOKING_PAID', 'PAYMENT_FAILED', 'REFUND_ISSUED',
          'DEPOSIT_RETURNED', 'PAYOUT_SENT', 'BOOKING_DECLINED',
          'BOOKING_EXPIRED', 'BOOKING_CANCELLED', 'OFFER_RECEIVED',
          'OFFER_BOOKED', 'MESSAGES_UNREAD'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE email_jobs
        DROP CONSTRAINT email_jobs_kind_check,
        ADD CONSTRAINT email_jobs_kind_check CHECK (kind IN (
          'BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_CONFIRMED',
          'BOOKING_PAID', 'PAYMENT_FAILED', 'BOOKING_DECLINED',
          'BOOKING_EXPIRED', 'BOOKING_CANCELLED', 'OFFER_RECEIVED',
          'OFFER_BOOKED', 'MESSAGES_UNREAD'))
    `);
  }
}
