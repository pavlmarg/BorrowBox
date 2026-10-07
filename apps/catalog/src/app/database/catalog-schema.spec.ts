import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
  DEPOSIT_MAX_CENTS,
  DEPOSIT_MIN_CENTS,
  ITEM_CATEGORIES,
  ITEM_DESCRIPTION_MAX_LENGTH,
  ITEM_PHOTOS_MAX,
  ITEM_STATUSES,
  ITEM_TITLE_MAX_LENGTH,
  ITEM_TITLE_MIN_LENGTH,
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  PHOTO_STATUSES,
  RATE_MAX_CENTS,
  RATE_MIN_CENTS,
} from '@borrowbox/contracts';
import { startPostgres, type TestPostgres } from '@borrowbox/testing';
import { createCatalogDataSource, runMigrations } from './database.module';

/**
 * The rules Catalog's tables enforce themselves (migration
 * 1759800000000-catalog-initial). Limits are checked at their boundaries
 * against the constants in libs/contracts, so the two can't drift apart.
 */
describe('Catalog schema (integration)', () => {
  let pg: TestPostgres;
  let db: DataSource;

  beforeAll(async () => {
    pg = await startPostgres();
    db = createCatalogDataSource(pg.urlFor('catalog'));
    await db.initialize();
    await runMigrations(db);
  });

  afterAll(async () => {
    await db?.destroy();
    await pg?.stop();
  });

  // Central Athens; the public point is ~200 m away, as after fuzzing.
  const EXACT = 'SRID=4326;POINT(23.7275 37.9838)';
  const PUBLIC = 'SRID=4326;POINT(23.7290 37.9852)';
  const located = {
    location: EXACT,
    location_public: PUBLIC,
    offset_m: 200,
    offset_bearing: 45,
  };

  async function insertItem(
    columns: Record<string, unknown> = {},
  ): Promise<string> {
    const row = {
      lender_id: randomUUID(),
      title: 'Cordless drill',
      category: 'tools',
      free: false,
      daily_cents: 1000,
      deposit_cents: 0,
      ...columns,
    };
    const names = Object.keys(row);
    const [{ id }] = await db.query(
      `INSERT INTO items (${names.join(', ')})
       VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING id`,
      Object.values(row),
    );
    return id;
  }

  async function insertPhoto(
    itemId: string,
    columns: Record<string, unknown> = {},
  ): Promise<string> {
    const row = {
      item_id: itemId,
      position: 0,
      upload_key: `incoming/${randomUUID()}`,
      content_type: 'image/jpeg',
      size_bytes: 1000,
      ...columns,
    };
    const names = Object.keys(row);
    const [{ id }] = await db.query(
      `INSERT INTO item_photos (${names.join(', ')})
       VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})
       RETURNING id`,
      Object.values(row),
    );
    return id;
  }

  /** The quoted values a `CHECK (col IN (...))` constraint allows. */
  async function allowedValues(constraint: string): Promise<string[]> {
    const [{ def }] = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`,
      [constraint],
    );
    return [...(def as string).matchAll(/'([^']+)'::text/g)]
      .map((m) => m[1])
      .sort();
  }

  describe('items', () => {
    it('allows exactly the statuses and categories in the contracts', async () => {
      expect(await allowedValues('items_status_check')).toEqual(
        [...ITEM_STATUSES].sort(),
      );
      expect(await allowedValues('items_category_check')).toEqual(
        [...ITEM_CATEGORIES].sort(),
      );
      await expect(insertItem({ category: 'weapons' })).rejects.toThrow(
        /items_category_check/,
      );
    });

    it('starts as a draft with an empty description', async () => {
      const id = await insertItem();
      const [row] = await db.query(
        `SELECT status, description FROM items WHERE id = $1`,
        [id],
      );
      expect(row).toEqual({ status: 'DRAFT', description: '' });
    });

    it('limits title and description length', async () => {
      await insertItem({ title: 'a'.repeat(ITEM_TITLE_MIN_LENGTH) });
      await insertItem({ title: 'a'.repeat(ITEM_TITLE_MAX_LENGTH) });
      await insertItem({
        description: 'a'.repeat(ITEM_DESCRIPTION_MAX_LENGTH),
      });
      await expect(
        insertItem({ title: 'a'.repeat(ITEM_TITLE_MIN_LENGTH - 1) }),
      ).rejects.toThrow(/items_title_check/);
      await expect(
        insertItem({ title: 'a'.repeat(ITEM_TITLE_MAX_LENGTH + 1) }),
      ).rejects.toThrow(/items_title_check/);
      await expect(
        insertItem({
          description: 'a'.repeat(ITEM_DESCRIPTION_MAX_LENGTH + 1),
        }),
      ).rejects.toThrow(/items_description_check/);
    });

    it('accepts a free item with no rates, or rates without free', async () => {
      await insertItem({ free: true, daily_cents: null });
      await insertItem({
        daily_cents: null,
        hourly_cents: 50,
        weekly_cents: 5000,
        monthly_cents: 15000,
      });
      await expect(insertItem({ free: true })).rejects.toThrow(
        /items_pricing_valid/,
      );
      await expect(insertItem({ daily_cents: null })).rejects.toThrow(
        /items_pricing_valid/,
      );
    });

    it.each(['hourly_cents', 'daily_cents', 'weekly_cents', 'monthly_cents'])(
      'keeps %s within the rate limits',
      async (column) => {
        const only = { daily_cents: null };
        await insertItem({ ...only, [column]: RATE_MIN_CENTS });
        await insertItem({ ...only, [column]: RATE_MAX_CENTS });
        await expect(
          insertItem({ ...only, [column]: RATE_MIN_CENTS - 1 }),
        ).rejects.toThrow(new RegExp(`items_${column}_check`));
        await expect(
          insertItem({ ...only, [column]: RATE_MAX_CENTS + 1 }),
        ).rejects.toThrow(new RegExp(`items_${column}_check`));
      },
    );

    it('keeps the deposit within its limits, also for free items', async () => {
      await insertItem({ deposit_cents: DEPOSIT_MIN_CENTS });
      await insertItem({
        free: true,
        daily_cents: null,
        deposit_cents: DEPOSIT_MAX_CENTS,
      });
      await expect(
        insertItem({ deposit_cents: DEPOSIT_MIN_CENTS - 1 }),
      ).rejects.toThrow(/items_deposit_cents_check/);
      await expect(
        insertItem({ deposit_cents: DEPOSIT_MAX_CENTS + 1 }),
      ).rejects.toThrow(/items_deposit_cents_check/);
    });

    it('sets both points and the offset together', async () => {
      await insertItem(located);
      await expect(insertItem({ location: EXACT })).rejects.toThrow(
        /items_location_complete/,
      );
      await expect(
        insertItem({ ...located, offset_bearing: null }),
      ).rejects.toThrow(/items_location_complete/);
    });

    it('keeps the offset within 150-300 m and the bearing below 360°', async () => {
      await insertItem({ ...located, offset_m: 150, offset_bearing: 0 });
      await insertItem({ ...located, offset_m: 300, offset_bearing: 359.9 });
      await expect(insertItem({ ...located, offset_m: 149.9 })).rejects.toThrow(
        /items_offset_m_check/,
      );
      await expect(insertItem({ ...located, offset_m: 300.1 })).rejects.toThrow(
        /items_offset_m_check/,
      );
      await expect(
        insertItem({ ...located, offset_bearing: 360 }),
      ).rejects.toThrow(/items_offset_bearing_check/);
    });

    it('needs a location and a publish date to be active', async () => {
      const publishedAt = new Date();
      await insertItem({
        ...located,
        status: 'ACTIVE',
        published_at: publishedAt,
      });
      await insertItem({
        ...located,
        status: 'PAUSED',
        published_at: publishedAt,
      });
      await expect(
        insertItem({ status: 'ACTIVE', published_at: publishedAt }),
      ).rejects.toThrow(/items_active_has_location/);
      await expect(
        insertItem({ ...located, status: 'ACTIVE' }),
      ).rejects.toThrow(/items_published_at_set/);
      await expect(insertItem({ status: 'PAUSED' })).rejects.toThrow(
        /items_published_at_set/,
      );
    });

    it('keeps a deleted item as a minimal tombstone', async () => {
      const deletedAt = new Date();
      await insertItem({ status: 'DELETED', deleted_at: deletedAt });
      await expect(insertItem({ status: 'DELETED' })).rejects.toThrow(
        /items_deleted_at_matches_status/,
      );
      await expect(insertItem({ deleted_at: deletedAt })).rejects.toThrow(
        /items_deleted_at_matches_status/,
      );
      await expect(
        insertItem({ ...located, status: 'DELETED', deleted_at: deletedAt }),
      ).rejects.toThrow(/items_tombstone_minimal/);
      await expect(
        insertItem({
          status: 'DELETED',
          deleted_at: deletedAt,
          description: 'Kept in the garage',
        }),
      ).rejects.toThrow(/items_tombstone_minimal/);
    });

    it('finds items by Greek words without accents or case, and by English words', async () => {
      const id = await insertItem({
        title: 'Δράπανο μπαταρίας',
        description: 'Cordless drill with two batteries',
      });
      const other = await insertItem({ title: 'Σκάλα αλουμινίου' });
      // Search combines both languages; step 9 uses the same expression.
      const search = async (q: string): Promise<string[]> =>
        (
          await db.query(
            `SELECT id FROM items
              WHERE id = ANY($2)
                AND search_vector @@ (websearch_to_tsquery('greek', $1)
                                   || websearch_to_tsquery('english', $1))`,
            [q, [id, other]],
          )
        ).map((r: { id: string }) => r.id);

      expect(await search('δραπανο')).toEqual([id]);
      expect(await search('ΔΡΆΠΑΝΑ')).toEqual([id]);
      expect(await search('drills')).toEqual([id]);
      expect(await search('σκάλες')).toEqual([other]);
      expect(await search('lawnmower')).toEqual([]);
    });

    it('measures distance on the public point', async () => {
      const id = await insertItem(located);
      // ~890 m north of the public point (and ~730 m from the exact one).
      const near = async (radiusM: number): Promise<boolean> =>
        (
          await db.query(
            `SELECT 1 FROM items
              WHERE id = $1
                AND ST_DWithin(location_public, ST_MakePoint(23.7290, 37.9932)::geography, $2)`,
            [id, radiusM],
          )
        ).length === 1;
      expect(await near(1000)).toBe(true);
      expect(await near(800)).toBe(false);
    });
  });

  describe('item_photos', () => {
    it('allows exactly the statuses and content types in the contracts', async () => {
      expect(await allowedValues('item_photos_status_check')).toEqual(
        [...PHOTO_STATUSES].sort(),
      );
      expect(await allowedValues('item_photos_content_type_check')).toEqual(
        [...PHOTO_CONTENT_TYPES].sort(),
      );
    });

    it('caps positions at the photo limit, one photo per position', async () => {
      const itemId = await insertItem();
      await insertPhoto(itemId, { position: ITEM_PHOTOS_MAX - 1 });
      await expect(
        insertPhoto(itemId, { position: ITEM_PHOTOS_MAX }),
      ).rejects.toThrow(/item_photos_position_check/);
      await expect(insertPhoto(itemId, { position: -1 })).rejects.toThrow(
        /item_photos_position_check/,
      );
      await expect(
        insertPhoto(itemId, { position: ITEM_PHOTOS_MAX - 1 }),
      ).rejects.toThrow(/item_photos_item_id_position_key/);
    });

    it('lets a reorder swap positions within one transaction', async () => {
      const itemId = await insertItem();
      const a = await insertPhoto(itemId, { position: 0 });
      const b = await insertPhoto(itemId, { position: 1 });
      await db.transaction(async (tx) => {
        await tx.query(`UPDATE item_photos SET position = 1 WHERE id = $1`, [
          a,
        ]);
        await tx.query(`UPDATE item_photos SET position = 0 WHERE id = $1`, [
          b,
        ]);
      });
      // A duplicate still fails, at commit.
      await expect(
        db.transaction((tx) =>
          tx.query(`UPDATE item_photos SET position = 1 WHERE id = $1`, [b]),
        ),
      ).rejects.toThrow(/item_photos_item_id_position_key/);
    });

    it('limits the size', async () => {
      const itemId = await insertItem();
      await insertPhoto(itemId, { size_bytes: PHOTO_MAX_BYTES });
      await expect(
        insertPhoto(itemId, { position: 1, size_bytes: PHOTO_MAX_BYTES + 1 }),
      ).rejects.toThrow(/item_photos_size_bytes_check/);
      await expect(
        insertPhoto(itemId, { position: 1, size_bytes: 0 }),
      ).rejects.toThrow(/item_photos_size_bytes_check/);
    });

    it('has a public key exactly when ready', async () => {
      const itemId = await insertItem();
      await insertPhoto(itemId, {
        status: 'READY',
        public_key: randomUUID(),
      });
      await expect(
        insertPhoto(itemId, { position: 1, status: 'READY' }),
      ).rejects.toThrow(/item_photos_public_key_when_ready/);
      await expect(
        insertPhoto(itemId, { position: 1, public_key: randomUUID() }),
      ).rejects.toThrow(/item_photos_public_key_when_ready/);
    });

    it('belongs to an existing item', async () => {
      await expect(insertPhoto(randomUUID())).rejects.toThrow(
        /item_photos_item_id_fkey/,
      );
    });
  });

  describe('photo_file_deletions', () => {
    it('lists each stored file once, of a known kind', async () => {
      const key = `items/${randomUUID()}`;
      await db.query(
        `INSERT INTO photo_file_deletions (kind, key) VALUES ('PUBLIC_PHOTO', $1)`,
        [key],
      );
      // The same file again is a no-op with ON CONFLICT, an error without.
      await expect(
        db.query(
          `INSERT INTO photo_file_deletions (kind, key) VALUES ('PUBLIC_PHOTO', $1)`,
          [key],
        ),
      ).rejects.toThrow(/photo_file_deletions_kind_key_key/);
      await db.query(
        `INSERT INTO photo_file_deletions (kind, key) VALUES ('UPLOAD', $1)`,
        [key],
      );
      await expect(
        db.query(
          `INSERT INTO photo_file_deletions (kind, key) VALUES ('THUMBNAIL', $1)`,
          [key],
        ),
      ).rejects.toThrow(/photo_file_deletions_kind_check/);
    });
  });

  describe('lenders', () => {
    it('needs a name until the account is deleted', async () => {
      await db.query(
        `INSERT INTO lenders (user_id, display_name, name_updated_at) VALUES ($1, 'Maria', now())`,
        [randomUUID()],
      );
      await db.query(
        `INSERT INTO lenders (user_id, name_updated_at, deleted_at) VALUES ($1, now(), now())`,
        [randomUUID()],
      );
      await expect(
        db.query(
          `INSERT INTO lenders (user_id, name_updated_at) VALUES ($1, now())`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/lenders_display_name_present/);
    });
  });

  // Last: it drops and recreates the tables.
  it('can be reverted and applied again', async () => {
    const tables = async (): Promise<string[]> =>
      (
        await db.query(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'catalog'
              AND table_name IN ('items', 'item_photos', 'lenders', 'photo_file_deletions')
            ORDER BY table_name`,
        )
      ).map((r: { table_name: string }) => r.table_name);

    await db.undoLastMigration(); // photo pipeline
    expect(await tables()).toEqual(['item_photos', 'items', 'lenders']);
    await db.undoLastMigration(); // initial
    expect(await tables()).toEqual([]);
    expect(await runMigrations(db)).toBe(2);
    expect(await tables()).toHaveLength(4);
  });
});
