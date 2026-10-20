import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `user.email_verified` is new, and accounts verified before it existed
 * (Google sign-ups) never sent it, so Catalog wouldn't let them publish.
 * Announce each live verified account once, through the outbox like any
 * event. Plain SQL with the v1 envelope spelled out, so this migration
 * never changes with the code.
 */
export class IdentityAnnounceVerifiedEmails1761000000001
  implements MigrationInterface
{
  name = 'IdentityAnnounceVerifiedEmails1761000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO outbox (event_id, routing_key, envelope)
      SELECT e.id, 'user.email_verified.v1',
             jsonb_build_object(
               'eventId', e.id,
               'type', 'user.email_verified',
               'version', 1,
               'occurredAt', to_char(u.email_verified_at AT TIME ZONE 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'correlationId', e.id,
               'causationId', NULL,
               'payload', jsonb_build_object('userId', u.id))
        FROM users u
       CROSS JOIN LATERAL (SELECT gen_random_uuid() AS id) e
       WHERE u.email_verified_at IS NOT NULL AND u.deleted_at IS NULL
       ORDER BY u.email_verified_at
    `);
  }

  async down(): Promise<void> {
    // Events already sent can't be taken back; nothing to undo.
  }
}
