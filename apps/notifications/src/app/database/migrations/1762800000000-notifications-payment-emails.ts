import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Checkout's emails (ADR-0019): a booking is paid (both people) and a
 * payment failed (the renter). Widens the kinds email jobs may have; the
 * list mirrors EMAIL_KINDS in libs/contracts.
 */
export class NotificationsPaymentEmails1762800000000 implements MigrationInterface {
  name = 'NotificationsPaymentEmails1762800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
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

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE email_jobs
        DROP CONSTRAINT email_jobs_kind_check,
        ADD CONSTRAINT email_jobs_kind_check CHECK (kind IN (
          'BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_CONFIRMED',
          'BOOKING_DECLINED', 'BOOKING_EXPIRED', 'BOOKING_CANCELLED',
          'OFFER_RECEIVED', 'OFFER_BOOKED', 'MESSAGES_UNREAD'))
    `);
  }
}
