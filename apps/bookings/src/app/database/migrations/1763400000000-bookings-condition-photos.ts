import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Condition photos (ADR-0027), processed like other photos (ADR-0009):
 * - `condition_photos`: each photo one of the two people took at a handoff,
 *   from upload (`PENDING`) to processed (`READY`, its sizes under
 *   `conditions/<file_key>/` in the private evidence bucket) or `FAILED`;
 * - `photo_file_deletions`: an outbox for stored files. Whatever orphans a
 *   file lists it here in the same transaction, and a job deletes the files,
 *   then the entry, so no file is ever left behind.
 */
export class BookingsConditionPhotos1763400000000 implements MigrationInterface {
  name = 'BookingsConditionPhotos1763400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE condition_photos (
        -- Chosen by the client, so a retried request finds the same row.
        id           uuid        PRIMARY KEY,
        booking_id   uuid        NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
        phase        text        NOT NULL CHECK (phase IN ('PICKUP', 'RETURN')),
        uploader_id  uuid        NOT NULL,
        status       text        NOT NULL DEFAULT 'PENDING'
                                 CHECK (status IN ('PENDING', 'READY', 'FAILED')),
        upload_key   text        NOT NULL UNIQUE,
        content_type text        NOT NULL CHECK (content_type IN (
                                   'image/jpeg', 'image/png', 'image/webp',
                                   'image/avif', 'image/gif', 'image/tiff')),
        size_bytes   integer     NOT NULL CHECK (size_bytes > 0),
        -- While READY: the processed sizes' folder in the evidence bucket.
        file_key     text        UNIQUE,
        -- When the browser said the upload finished: the evidence's time.
        confirmed_at timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT condition_photos_ready_has_file
          CHECK ((status = 'READY') = (file_key IS NOT NULL))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX condition_photos_booking_idx ON condition_photos (booking_id, phase, uploader_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX condition_photos_uploader_idx ON condition_photos (uploader_id)`,
    );
    await queryRunner.query(`
      CREATE TABLE photo_file_deletions (
        id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        -- UPLOAD: one raw file in the uploads bucket, at \`key\`.
        -- EVIDENCE: a processed photo's sizes in the evidence bucket,
        -- under conditions/<key>/.
        kind       text        NOT NULL CHECK (kind IN ('UPLOAD', 'EVIDENCE')),
        key        text        NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        -- Not deleted before this: the worker lists the files it is about to
        -- write with a delay, and cancels it once they are the photo's.
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
    await queryRunner.query(`DROP TABLE condition_photos`);
  }
}
