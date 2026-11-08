import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `user.email_verified` is new, and accounts verified before it existed
 * (Google sign-ups) never sent it, so Catalog wouldn't let them publish.
 * Announce each live verified account once, through the outbox like any
 * event. Plain SQL with the v1 envelope spelled out, so this migration
 * never changes with the code.
 */
export class IdentityAnnounceVerifiedEmails1761000000001 implements MigrationInterface {
  name = 'IdentityAnnounceVerifiedEmails1761000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The id is drawn in the subquery's select list, so it is evaluated once
    // per user. (An uncorrelated LATERAL (SELECT gen_random_uuid()) is
    // evaluated only once, giving every row the same event id.)
    await queryRunner.query(`
      INSERT INTO outbox (event_id, routing_key, envelope)
      SELECT e.event_id, 'user.email_verified.v1',
             jsonb_build_object(
               'eventId', e.event_id,
               'type', 'user.email_verified',
               'version', 1,
               'occurredAt', to_char(e.email_verified_at AT TIME ZONE 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'correlationId', e.event_id,
               'causationId', NULL,
               'payload', jsonb_build_object('userId', e.user_id))
        FROM (SELECT gen_random_uuid() AS event_id, u.id AS user_id,
                     u.email_verified_at
                FROM users u
               WHERE u.email_verified_at IS NOT NULL AND u.deleted_at IS NULL) e
       ORDER BY e.email_verified_at
    `);
  }

  async down(): Promise<void> {
    // Events already sent can't be taken back; nothing to undo.
  }
}
