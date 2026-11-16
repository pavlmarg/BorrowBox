import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Damage claim emails (ADR-0028): filed, agreed, disagreed, withdrawn,
 * decided. Widens the kinds email jobs may have; the list mirrors
 * EMAIL_KINDS in libs/contracts.
 */
export class NotificationsClaimEmails1763500000000 implements MigrationInterface {
  name = 'NotificationsClaimEmails1763500000000';

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
          'BOOKING_RETURNED', 'BOOKING_IN_REVIEW', 'CLAIM_FILED',
          'CLAIM_AGREED', 'CLAIM_DISAGREED', 'CLAIM_WITHDRAWN',
          'CLAIM_DECIDED'))
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
          'OFFER_BOOKED', 'MESSAGES_UNREAD', 'HANDOFF_QUESTION',
          'BOOKING_RETURNED', 'BOOKING_IN_REVIEW'))
    `);
  }
}
