import type { DataSource } from 'typeorm';
import { createServiceDataSource } from '@borrowbox/service-kit';
import { startPostgres, type TestPostgres } from '@borrowbox/testing';
import { MIGRATIONS } from '../database.module';
import { IdentityAnnounceVerifiedEmails1761000000001 } from './1761000000001-identity-announce-verified-emails';

/** The one-off announcement of accounts verified before `user.email_verified` existed. */
describe('IdentityAnnounceVerifiedEmails migration (integration)', () => {
  let pg: TestPostgres;
  let db: DataSource;

  beforeAll(async () => {
    pg = await startPostgres();
    const earlier = MIGRATIONS.filter(
      (m) => m !== IdentityAnnounceVerifiedEmails1761000000001,
    );
    db = createServiceDataSource(pg.urlFor('identity'), earlier);
    await db.initialize();
    await db.runMigrations();
  });

  afterAll(async () => {
    await db?.destroy();
    await pg?.stop();
  });

  it('emits one user.email_verified.v1 per live verified account', async () => {
    const [verified] = await db.query(
      `INSERT INTO users (email, display_name, email_verified_at)
       VALUES ('v@example.com', 'V', '2026-10-01T10:00:00.123Z') RETURNING id`,
    );
    await db.query(
      `INSERT INTO users (email, display_name) VALUES ('u@example.com', 'U')`,
    );
    await db.query(
      `INSERT INTO users (email, display_name, email_verified_at, deleted_at)
       VALUES ('d@example.com', NULL, now(), now())`,
    );

    const runner = db.createQueryRunner();
    try {
      await new IdentityAnnounceVerifiedEmails1761000000001().up(runner);
    } finally {
      await runner.release();
    }

    const rows = await db.query(
      `SELECT event_id, routing_key, envelope FROM outbox`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].routing_key).toBe('user.email_verified.v1');
    expect(rows[0].envelope).toEqual({
      eventId: rows[0].event_id,
      type: 'user.email_verified',
      version: 1,
      occurredAt: '2026-10-01T10:00:00.123Z',
      correlationId: rows[0].event_id,
      causationId: null,
      payload: { userId: verified.id },
    });
  });
});
