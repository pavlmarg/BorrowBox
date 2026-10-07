import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The photo pipeline (ADR-0009, ADR-0013). Adds no data and rewrites none:
 * - more accepted upload types (the CHECK only widens; existing rows pass);
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

    await queryRunner.query(`
      CREATE TABLE photo_file_deletions (
        id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        -- UPLOAD: one raw file in the private bucket, at \`key\`.
        -- PUBLIC_PHOTO: a processed photo's sizes in the public bucket,
        -- under items/<key>/.
        kind       text        NOT NULL CHECK (kind IN ('UPLOAD', 'PUBLIC_PHOTO')),
        key        text        NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        attempts   integer     NOT NULL DEFAULT 0,
        CONSTRAINT photo_file_deletions_kind_key_key UNIQUE (kind, key)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE photo_file_deletions`);
    // Fails if photos of the newer types exist; delete those first.
    await queryRunner.query(`
      ALTER TABLE item_photos
        DROP CONSTRAINT item_photos_content_type_check,
        ADD CONSTRAINT item_photos_content_type_check
          CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp'))
    `);
  }
}
