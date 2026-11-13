import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { createServiceDataSource } from '@borrowbox/service-kit';
import { startPostgres, type TestPostgres } from '@borrowbox/testing';
import { MIGRATIONS } from '../database/database.module';
import { republishRegistered, republishUsers } from './republish-users';

/** `nx run identity:republish-users`, for services that started later. */
describe('republishUsers (integration)', () => {
  let pg: TestPostgres;
  let db: DataSource;
  const BASE = 'https://photos.test/borrowbox-public';
  const config = new ConfigService({ PHOTOS_BASE_URL: BASE });

  beforeAll(async () => {
    pg = await startPostgres();
    db = createServiceDataSource(pg.urlFor('identity'), MIGRATIONS);
    await db.initialize();
    await db.runMigrations();
  });

  afterAll(async () => {
    await db?.destroy();
    await pg?.stop();
  });

  it('announces each live account, its verification, and never an email', async () => {
    await db.query(`DELETE FROM outbox`);
    const [verified] = await db.query(
      `INSERT INTO users (email, display_name, locale, email_verified_at, photo_key)
       VALUES ('v@example.com', 'Vera', 'en', now(), 'k1') RETURNING id`,
    );
    const [unverified] = await db.query(
      `INSERT INTO users (email, display_name) VALUES ('u@example.com', 'Ugo')
       RETURNING id`,
    );
    await db.query(
      `INSERT INTO users (email, display_name, email_verified_at, deleted_at)
       VALUES ('d@example.com', NULL, now(), now())`,
    );

    expect(await republishUsers(db, config)).toBe(
      '2 account(s) (1 verified) written to the outbox',
    );
    const rows: Array<{ routing_key: string; payload: unknown }> =
      await db.query(
        `SELECT routing_key, envelope->'payload' AS payload FROM outbox ORDER BY id`,
      );
    expect(rows).toEqual([
      {
        routing_key: 'user.profile_updated.v1',
        payload: {
          userId: verified.id,
          displayName: 'Vera',
          locale: 'en',
          photo: {
            small: `${BASE}/profiles/k1/96.webp`,
            large: `${BASE}/profiles/k1/512.webp`,
          },
        },
      },
      {
        routing_key: 'user.email_verified.v1',
        payload: { userId: verified.id },
      },
      {
        routing_key: 'user.profile_updated.v1',
        payload: {
          userId: unverified.id,
          displayName: 'Ugo',
          locale: 'el',
          photo: null,
        },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain('@example.com');
  });

  it('re-sends user.registered with the email when asked to', async () => {
    await db.query(`DELETE FROM outbox`);
    await republishRegistered(db, config);
    const rows: Array<{ routing_key: string; email: string | null }> =
      await db.query(
        `SELECT routing_key, envelope->'payload'->>'email' AS email
           FROM outbox ORDER BY id`,
      );
    expect(rows).toEqual([
      { routing_key: 'user.registered.v1', email: 'v@example.com' },
      { routing_key: 'user.email_verified.v1', email: null },
      { routing_key: 'user.registered.v1', email: 'u@example.com' },
    ]);
  });
});
