import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The photo pipeline (ADR-0009, ADR-0013). Adds no data and rewrites none:
 * - more accepted upload types (the CHECK only widens; existing rows pass);
 * - `item_photos.confirmed_at` (nullable; existing rows stay null);
 * - `photo_file_deletions`, an outbox for stored files: a photo's row is
 *   deleted and its files are listed here in one transaction, and a job
 *   deletes the files and then the entry, so no file is ever orphaned.
 */
export class CatalogPhotoPipeline1759900000000 implements MigrationInterface {
  name = 'CatalogPhotoPipeline1759900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE item_photos
        DROP CONSTRAINT item_photos_content_type_check,
        ADD CONSTRAINT item_photos_content_type_check CHECK (content_type IN (
          'image/jpeg', 'image/png', 'image/webp',
          'image/avif', 'image/gif', 'image/tiff'
        ))
    `);

    // Set by "confirm": the upload is in storage and processing was asked
    // for. The sweeper retries confirmed photos still PENDING, and deletes
    // ones never confirmed after a day.
    await queryRunner.query(
      `ALTER TABLE item_photos ADD COLUMN confirmed_at timestamptz`,
    );
    await queryRunner.query(
      `CREATE INDEX item_photos_confirmed_pending_idx ON item_photos (confirmed_at)
         WHERE status = 'PENDING' AND confirmed_at IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE photo_file_deletions (
        id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        -- UPLOAD: one raw file in the private bucket, at \`key\`.
        -- PUBLIC_PHOTO: a processed photo's sizes in the public bucket,
        -- under items/<key>/.
        kind       text        NOT NULL CHECK (kind IN ('UPLOAD', 'PUBLIC_PHOTO')),
        key        text        NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        -- Not deleted before this. The worker records the files it is about
        -- to write with a delay, then removes the entry once the photo is
        -- READY: a crash in between still gets them cleaned up, and the
        -- cleanup never races the worker.
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
    await queryRunner.query(`ALTER TABLE item_photos DROP COLUMN confirmed_at`);
    // Fails if photos of the newer types exist; delete those first.
    await queryRunner.query(`
      ALTER TABLE item_photos
        DROP CONSTRAINT item_photos_content_type_check,
        ADD CONSTRAINT item_photos_content_type_check
          CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp'))
    `);
  }
}
