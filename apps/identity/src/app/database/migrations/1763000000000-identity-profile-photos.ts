import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Profile photos (ADR-0024), processed like item photos (ADR-0009):
 * - `users.photo_key`: the current processed photo's folder in the public
 *   bucket (`profiles/<key>/`), or null for the silhouette;
 * - `user_photos`: at most one new upload per user, waiting to be processed
 *   (`PENDING`) or rejected (`FAILED`); a new upload replaces it;
 * - `photo_file_deletions`: an outbox for stored files. Whatever orphans a
 *   file lists it here in the same transaction, and a job deletes the files,
 *   then the entry, so no file is ever left behind.
 */
export class IdentityProfilePhotos1763000000000 implements MigrationInterface {
  name = 'IdentityProfilePhotos1763000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN photo_key text`);
    await queryRunner.query(`
      CREATE TABLE user_photos (
        id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      uuid        NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
        status       text        NOT NULL DEFAULT 'PENDING'
                                 CHECK (status IN ('PENDING', 'FAILED')),
        upload_key   text        NOT NULL UNIQUE,
        content_type text        NOT NULL CHECK (content_type IN (
                                   'image/jpeg', 'image/png', 'image/webp',
                                   'image/avif', 'image/gif', 'image/tiff')),
        size_bytes   integer     NOT NULL CHECK (size_bytes > 0),
        -- Set when the browser says the upload finished; processing follows.
        confirmed_at timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE photo_file_deletions (
        id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        -- UPLOAD: one raw file in the private bucket, at \`key\`.
        -- PUBLIC_PHOTO: a processed photo's sizes in the public bucket,
        -- under profiles/<key>/.
        kind       text        NOT NULL CHECK (kind IN ('UPLOAD', 'PUBLIC_PHOTO')),
        key        text        NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        -- Not deleted before this: the worker lists the files it is about to
        -- write with a delay, and cancels it once they are the user's photo.
        not_before timestamptz NOT NULL DEFAULT now(),
        attempts   integer     NOT NULL DEFAULT 0,
        CONSTRAINT photo_file_deletions_kind_key_key UNIQUE (kind, key)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX photo_file_deletions_due_idx ON photo_file_deletions (not_before)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE photo_file_deletions`);
    await queryRunner.query(`DROP TABLE user_photos`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN photo_key`);
  }
}
