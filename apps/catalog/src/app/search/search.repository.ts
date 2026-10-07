import type { EntityManager } from 'typeorm';
import type { GeoPoint, ItemCategory, PriceUnit } from '@borrowbox/contracts';
import type { ItemRow } from '../items/items.repository';
import type { SearchCursor } from './search-paging';

/**
 * Public reads (ADR-0007). Every query here:
 * - sees only ACTIVE items whose lender is known and not deleted;
 * - filters, sorts and measures on `location_public` only, and never
 *   selects `location` or the offset;
 * - is fixed SQL: optional filters are `($n IS NULL OR …)`.
 */

/** A public item with its lender and cover, as the queries return it. */
export type PublicItemRow = Pick<
  ItemRow,
  | 'id'
  | 'title'
  | 'description'
  | 'category'
  | 'free'
  | 'hourly_cents'
  | 'daily_cents'
  | 'weekly_cents'
  | 'monthly_cents'
  | 'deposit_cents'
  | 'public_lat'
  | 'public_lng'
  | 'published_at'
> & {
  lender_id: string;
  lender_name: string;
  /** The first READY photo's key, if any. */
  cover_key: string | null;
  /** Metres from the reference point to the public point. */
  distance_m: number;
};

export interface SearchFilters {
  near: GeoPoint;
  radiusM: number;
  /** Trimmed; null for none. */
  text: string | null;
  category: ItemCategory | null;
  freeOnly: boolean;
  maxPriceCents: number | null;
  priceUnit: PriceUnit | null;
  after: SearchCursor | null;
  limit: number;
}

// The public columns, the lender and the cover. Fixed SQL, joined with +.
const PUBLIC_COLUMNS =
  'i.id, i.title, i.description, i.category, i.free,' +
  ' i.hourly_cents, i.daily_cents, i.weekly_cents, i.monthly_cents,' +
  ' i.deposit_cents, i.published_at,' +
  ' ST_Y(i.location_public::geometry) AS public_lat,' +
  ' ST_X(i.location_public::geometry) AS public_lng,' +
  ' l.user_id AS lender_id, l.display_name AS lender_name,' +
  ' (SELECT ph.public_key FROM item_photos ph' +
  "   WHERE ph.item_id = i.id AND ph.status = 'READY'" +
  '   ORDER BY ph.position LIMIT 1) AS cover_key';

const VISIBLE =
  ' FROM items i' +
  ' JOIN lenders l ON l.user_id = i.lender_id AND l.deleted_at IS NULL';

/** Nearest first, then id; `limit` rows after the cursor. */
export async function searchItems(
  tx: EntityManager,
  f: SearchFilters,
): Promise<PublicItemRow[]> {
  return tx.query(
    'SELECT ' +
      PUBLIC_COLUMNS +
      ', ST_Distance(i.location_public, p.pt) AS distance_m' +
      VISIBLE +
      ' CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography AS pt) p' +
      ` WHERE i.status = 'ACTIVE'
          AND ST_DWithin(i.location_public, p.pt, $3::float8)
          AND ($4::text IS NULL
               OR i.search_vector @@ (websearch_to_tsquery('greek', $4::text)
                                   || websearch_to_tsquery('english', $4::text)))
          AND ($5::text IS NULL OR i.category = $5::text)
          AND (NOT $6::boolean OR i.free)
          AND ($7::int IS NULL OR i.free OR
               CASE $8::text WHEN 'HOUR' THEN i.hourly_cents
                             WHEN 'DAY' THEN i.daily_cents
                             WHEN 'WEEK' THEN i.weekly_cents
                             WHEN 'MONTH' THEN i.monthly_cents
               END <= $7::int)
          AND ($9::float8 IS NULL
               OR ST_Distance(i.location_public, p.pt) > $9::float8
               OR (ST_Distance(i.location_public, p.pt) = $9::float8 AND i.id > $10::uuid))
        ORDER BY distance_m, i.id
        LIMIT $11::int`,
    [
      f.near.lng,
      f.near.lat,
      f.radiusM,
      f.text,
      f.category,
      f.freeOnly,
      f.maxPriceCents,
      f.priceUnit,
      f.after?.distanceM ?? null,
      f.after?.itemId ?? null,
      f.limit,
    ],
  );
}

/**
 * Search as you type: the nearest visible items in which every word matches
 * as a prefix of a stored word ("δραπ" → "Δράπανο"), or its Greek or
 * English stem does ("σκάλες" → "Σκάλα", "μπαταρια" → "μπαταρίας",
 * "drills" → "drill"). `words` must contain only letters and digits, so
 * `to_tsquery` can't meet any syntax.
 */
export async function suggestItems(
  tx: EntityManager,
  near: GeoPoint,
  radiusM: number,
  words: string[],
  limit: number,
): Promise<PublicItemRow[]> {
  return tx.query(
    'SELECT ' +
      PUBLIC_COLUMNS +
      ', ST_Distance(i.location_public, p.pt) AS distance_m' +
      VISIBLE +
      ' CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography AS pt) p' +
      ` WHERE i.status = 'ACTIVE'
          AND ST_DWithin(i.location_public, p.pt, $3::float8)
          AND NOT EXISTS (
            SELECT 1 FROM unnest($4::text[]) AS w(word)
             WHERE NOT (i.search_vector @@ (to_tsquery('simple', w.word || ':*')
                                         || to_tsquery('greek', w.word || ':*')
                                         || to_tsquery('english', w.word || ':*'))))
        ORDER BY distance_m, i.id
        LIMIT $5::int`,
    [near.lng, near.lat, radiusM, words, limit],
  );
}

/** The public item, or null if it isn't publicly visible. */
export async function findPublicItem(
  tx: EntityManager,
  itemId: string,
): Promise<Omit<PublicItemRow, 'distance_m'> | null> {
  const [row] = await tx.query(
    'SELECT ' +
      PUBLIC_COLUMNS +
      VISIBLE +
      " WHERE i.id = $1 AND i.status = 'ACTIVE'",
    [itemId],
  );
  return row ?? null;
}

/** READY photos of a public item, in display order. */
export async function listPublicPhotos(
  tx: EntityManager,
  itemId: string,
): Promise<Array<{ id: string; public_key: string }>> {
  return tx.query(
    `SELECT id, public_key FROM item_photos
      WHERE item_id = $1 AND status = 'READY'
      ORDER BY position`,
    [itemId],
  );
}
