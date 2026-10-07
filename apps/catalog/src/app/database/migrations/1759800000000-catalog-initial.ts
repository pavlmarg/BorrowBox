import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catalog's own tables. Unqualified names: the `catalog_svc` role's
 * search_path puts them in the `catalog` schema, with PostGIS types from
 * `public` (ADR-0002).
 *
 * Limits are literals on purpose: a migration must never change once it has
 * run. They mirror `libs/contracts` (catalog/validation.ts, categories.ts),
 * and catalog-schema.spec.ts fails if the two disagree.
 */
export class CatalogInitial1759800000000 implements MigrationInterface {
  name = 'CatalogInitial1759800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Read model of lender names, built from Identity's user.* events.
    await queryRunner.query(`
      CREATE TABLE lenders (
        user_id         uuid        PRIMARY KEY,
        -- Null once the account is deleted.
        display_name    text,
        -- occurredAt of the event the name came from; the newest event wins.
        name_updated_at timestamptz NOT NULL,
        deleted_at      timestamptz,
        CONSTRAINT lenders_display_name_present
          CHECK (deleted_at IS NOT NULL OR display_name IS NOT NULL)
      )
    `);

    // No foreign key to lenders: the user.registered event may arrive after
    // the lender's first command. Public reads join lenders instead.
    await queryRunner.query(`
      CREATE TABLE items (
        id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        lender_id      uuid        NOT NULL,
        status         text        NOT NULL DEFAULT 'DRAFT'
          CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'DELETED')),
        title          text        NOT NULL
          CHECK (char_length(title) BETWEEN 3 AND 80),
        description    text        NOT NULL DEFAULT ''
          CHECK (char_length(description) <= 2000),
        category       text        NOT NULL CHECK (category IN (
          'tools', 'diy-ladders', 'garden', 'cleaning', 'kitchen',
          'electronics', 'photo-video', 'music', 'sports', 'camping',
          'travel', 'kids', 'party', 'vehicles', 'other'
        )),

        -- Rate card in euro cents (ADR-0010); a null rate isn't offered.
        free           boolean     NOT NULL,
        hourly_cents   integer     CHECK (hourly_cents  BETWEEN 10 AND 100000),
        daily_cents    integer     CHECK (daily_cents   BETWEEN 10 AND 100000),
        weekly_cents   integer     CHECK (weekly_cents  BETWEEN 10 AND 100000),
        monthly_cents  integer     CHECK (monthly_cents BETWEEN 10 AND 100000),
        deposit_cents  integer     NOT NULL CHECK (deposit_cents BETWEEN 0 AND 500000),

        -- Exact point: only ever shown to the owner (and later a PAID renter).
        location        geography(Point, 4326),
        -- The exact point moved by the stored offset (ADR-0007). Every
        -- search and public read uses this one.
        location_public geography(Point, 4326),
        offset_m        double precision CHECK (offset_m BETWEEN 150 AND 300),
        -- Degrees clockwise from north.
        offset_bearing  double precision CHECK (offset_bearing >= 0 AND offset_bearing < 360),

        search_vector  tsvector    GENERATED ALWAYS AS (
          setweight(to_tsvector('greek'::regconfig, title), 'A') ||
          setweight(to_tsvector('english'::regconfig, title), 'A') ||
          setweight(to_tsvector('greek'::regconfig, description), 'B') ||
          setweight(to_tsvector('english'::regconfig, description), 'B')
        ) STORED,

        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now(),
        published_at   timestamptz,
        deleted_at     timestamptz,

        -- Free with no rates, or at least one rate.
        CONSTRAINT items_pricing_valid CHECK (
          CASE WHEN free
            THEN num_nonnulls(hourly_cents, daily_cents, weekly_cents, monthly_cents) = 0
            ELSE num_nonnulls(hourly_cents, daily_cents, weekly_cents, monthly_cents) > 0
          END
        ),
        -- Both points and the offset are set together, or not at all.
        CONSTRAINT items_location_complete CHECK (
          num_nulls(location, location_public, offset_m, offset_bearing) IN (0, 4)
        ),
        CONSTRAINT items_active_has_location
          CHECK (status <> 'ACTIVE' OR location IS NOT NULL),
        CONSTRAINT items_published_at_set
          CHECK (status NOT IN ('ACTIVE', 'PAUSED') OR published_at IS NOT NULL),
        CONSTRAINT items_deleted_at_matches_status
          CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL)),
        -- A tombstone keeps what past bookings may refer to, not the home
        -- location or the description (GDPR data minimisation).
        CONSTRAINT items_tombstone_minimal
          CHECK (status <> 'DELETED' OR (location IS NULL AND description = ''))
      )
    `);
    // Search only ever looks at ACTIVE items.
    await queryRunner.query(
      `CREATE INDEX items_location_public_active_idx ON items
         USING gist (location_public) WHERE status = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE INDEX items_search_vector_active_idx ON items
         USING gin (search_vector) WHERE status = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE INDEX items_lender_id_idx ON items (lender_id, created_at)`,
    );

    // ADR-0009. Only READY photos are ever shown; their files live in the
    // public bucket under public_key, the original under upload_key.
    await queryRunner.query(`
      CREATE TABLE item_photos (
        id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        item_id      uuid        NOT NULL REFERENCES items (id),
        status       text        NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING', 'READY', 'FAILED')),
        -- 0 is the cover. With the unique key below, this also caps an item
        -- at 10 photos; Catalog checks the limit first, under a row lock on the item.
        position     smallint    NOT NULL CHECK (position BETWEEN 0 AND 9),
        upload_key   text        NOT NULL UNIQUE,
        content_type text        NOT NULL
          CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
        size_bytes   integer     NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
        -- Random, never reused; URLs are built from a configured base URL.
        public_key   text        UNIQUE,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT item_photos_public_key_when_ready
          CHECK ((status = 'READY') = (public_key IS NOT NULL)),
        -- Deferred, so a reorder can swap positions within one transaction.
        CONSTRAINT item_photos_item_id_position_key
          UNIQUE (item_id, position) DEFERRABLE INITIALLY DEFERRED
      )
    `);
    // For the sweeper that retries or removes stuck uploads.
    await queryRunner.query(
      `CREATE INDEX item_photos_pending_idx ON item_photos (created_at)
         WHERE status = 'PENDING'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE item_photos`);
    await queryRunner.query(`DROP TABLE items`);
    await queryRunner.query(`DROP TABLE lenders`);
  }
}
