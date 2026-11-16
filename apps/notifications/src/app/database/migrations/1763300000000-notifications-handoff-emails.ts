import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Handoff emails (ADR-0026): "did the pickup (return) happen?", the item
 * was returned, an admin will look into it. Widens the kinds email jobs may
 * have; the list mirrors EMAIL_KINDS in libs/contracts.
 */
export class NotificationsHandoffEmails1763300000000 implements MigrationInterface {
  name = 'NotificationsHandoffEmails1763300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE email_jobs
        DROP CONSTRAINT email_jobs_kind_check,
        ADD CONSTRAINT email_jobs_kind_check CHECK (kind IN (
          'BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_CONFIRMED',
          'BOOKING_PAID', 'PAYMENT_FAILED', 'REFUND_ISSUED',
          'DEPOSIT_RETURNED', 'PAYOUT_SENT', 'BOOKING_DECLINED',
          'BOOKING_EXPIRED', 'BOOKING_CANCELLED', 'OFFER_RECEIVED',
          'OFFER_BOOKED', 'MESSAGES_UNREAD', 'HANDOFF_QUESTION',
          'BOOKING_RETURNED', 'BOOKING_IN_REVIEW'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
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
}
