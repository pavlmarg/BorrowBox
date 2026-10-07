import type { EntityManager } from 'typeorm';
import {
  PHOTO_VARIANTS,
  type GeoPoint,
  type ItemCategory,
  type ItemPricing,
  type ItemSnapshotV1,
  type ItemStatus,
  type OwnItem,
  type PhotoStatus,
  type PhotoUrls,
  type PhotoView,
} from '@borrowbox/contracts';
import type { LocationOffset } from './location-fuzz';

/** An `items` row as Catalog reads it. Points are split into lat/lng. */
export interface ItemRow {
  id: string;
  lender_id: string;
  status: ItemStatus;
  title: string;
  description: string;
  category: ItemCategory;
  free: boolean;
  hourly_cents: number | null;
  daily_cents: number | null;
  weekly_cents: number | null;
  monthly_cents: number | null;
  deposit_cents: number;
  lat: number | null;
  lng: number | null;
  public_lat: number | null;
  public_lng: number | null;
  offset_m: number | null;
  offset_bearing: number | null;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
}

/** The editable fields, as written by create and update. */
export interface ItemFields {
  title: string;
  description: string;
  category: ItemCategory;
  pricing: ItemPricing;
  depositCents: number;
}

interface PhotoRow {
  id: string;
  item_id: string;
  status: PhotoStatus;
  position: number;
  public_key: string | null;
}

// Fixed SQL only: values always go in as $n parameters.
const ITEM_SELECT =
  'SELECT id, lender_id, status, title, description, category, free,' +
  ' hourly_cents, daily_cents, weekly_cents, monthly_cents, deposit_cents,' +
  ' ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,' +
  ' ST_Y(location_public::geometry) AS public_lat,' +
  ' ST_X(location_public::geometry) AS public_lng,' +
  ' offset_m, offset_bearing, created_at, updated_at, published_at' +
  ' FROM items';

/** The lender's item, deleted or not, locked for the rest of the transaction. */
export async function lockOwnItem(
  tx: EntityManager,
  itemId: string,
  lenderId: string,
): Promise<ItemRow | null> {
  const [row] = await tx.query(
    ITEM_SELECT + ' WHERE id = $1 AND lender_id = $2 FOR UPDATE',
    [itemId, lenderId],
  );
  return row ?? null;
}

/** Any item with this id, whoever owns it (for create's id check). */
export async function findItemOwner(
  tx: EntityManager,
  itemId: string,
): Promise<{ lender_id: string; status: ItemStatus } | null> {
  const [row] = await tx.query(
    `SELECT lender_id, status FROM items WHERE id = $1`,
    [itemId],
  );
  return row ?? null;
}

export async function findOwnItem(
  tx: EntityManager,
  itemId: string,
  lenderId: string,
): Promise<ItemRow | null> {
  const [row] = await tx.query(
    ITEM_SELECT + " WHERE id = $1 AND lender_id = $2 AND status <> 'DELETED'",
    [itemId, lenderId],
  );
  return row ?? null;
}

/** Newest first. */
export async function listOwnItems(
  tx: EntityManager,
  lenderId: string,
): Promise<ItemRow[]> {
  return tx.query(
    ITEM_SELECT +
      " WHERE lender_id = $1 AND status <> 'DELETED'" +
      ' ORDER BY created_at DESC, id',
    [lenderId],
  );
}

/** Items that count towards the lender's limit: everything not deleted. */
export async function countLenderItems(
  tx: EntityManager,
  lenderId: string,
): Promise<number> {
  const [{ count }] = await tx.query(
    `SELECT count(*)::int AS count FROM items
      WHERE lender_id = $1 AND status <> 'DELETED'`,
    [lenderId],
  );
  return count;
}

/** @returns false if the id is already taken (by anyone). */
export async function insertItem(
  tx: EntityManager,
  itemId: string,
  lenderId: string,
  fields: ItemFields,
): Promise<boolean> {
  const rows: unknown[] = await tx.query(
    `INSERT INTO items (id, lender_id, title, description, category, free,
                        hourly_cents, daily_cents, weekly_cents, monthly_cents,
                        deposit_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [itemId, lenderId, ...fieldValues(fields)],
  );
  return rows.length === 1;
}

export async function updateItemFields(
  tx: EntityManager,
  itemId: string,
  fields: ItemFields,
): Promise<void> {
  await tx.query(
    `UPDATE items
        SET title = $2, description = $3, category = $4, free = $5,
            hourly_cents = $6, daily_cents = $7, weekly_cents = $8,
            monthly_cents = $9, deposit_cents = $10, updated_at = now()
      WHERE id = $1`,
    [itemId, ...fieldValues(fields)],
  );
}

function fieldValues(fields: ItemFields): unknown[] {
  const { pricing } = fields;
  return [
    fields.title,
    fields.description,
    fields.category,
    pricing.free,
    pricing.hourlyCents ?? null,
    pricing.dailyCents ?? null,
    pricing.weeklyCents ?? null,
    pricing.monthlyCents ?? null,
    fields.depositCents,
  ];
}

/** Metres from the item's current exact point to `to`; null if it has none. */
export async function distanceFromPin(
  tx: EntityManager,
  itemId: string,
  to: GeoPoint,
): Promise<number | null> {
  const [{ moved_m }] = await tx.query(
    `SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography) AS moved_m
       FROM items WHERE id = $1`,
    [itemId, to.lng, to.lat],
  );
  return moved_m;
}

/**
 * Stores the exact pin and the offset, and derives the public point from
 * them in the same statement (ADR-0007).
 */
export async function setItemLocation(
  tx: EntityManager,
  itemId: string,
  pin: GeoPoint,
  offset: LocationOffset,
): Promise<void> {
  await tx.query(
    `UPDATE items
        SET location = ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography,
            offset_m = $4::float8,
            offset_bearing = $5::float8,
            location_public = ST_Project(
              ST_SetSRID(ST_MakePoint($2::float8, $3::float8), 4326)::geography, $4::float8, radians($5::float8)
            ),
            updated_at = now()
      WHERE id = $1`,
    [itemId, pin.lng, pin.lat, offset.distanceM, offset.bearingDeg],
  );
}

/** `published_at` is set on the first publish only. */
export async function setItemStatus(
  tx: EntityManager,
  itemId: string,
  status: ItemStatus,
): Promise<void> {
  await tx.query(
    `UPDATE items
        SET status = $2,
            published_at = CASE WHEN $2 = 'ACTIVE'
                                THEN COALESCE(published_at, now())
                                ELSE published_at END,
            updated_at = now()
      WHERE id = $1`,
    [itemId, status],
  );
}

export async function countReadyPhotos(
  tx: EntityManager,
  itemId: string,
): Promise<number> {
  const [{ count }] = await tx.query(
    `SELECT count(*)::int AS count FROM item_photos
      WHERE item_id = $1 AND status = 'READY'`,
    [itemId],
  );
  return count;
}

/**
 * Turns items into minimal tombstones (ADR-0007, GDPR): no location, offset
 * or description. All of `lenderId`'s items, or just `itemId` if given.
 * Photos are handled with the photo pipeline (step 10).
 *
 * @returns the ids tombstoned now (already-deleted ones are left alone)
 */
export async function tombstoneItems(
  tx: EntityManager,
  lenderId: string,
  itemId: string | null,
): Promise<string[]> {
  // TypeORM returns [rows, rowCount] for UPDATE … RETURNING.
  const [rows]: [Array<{ id: string }>, number] = await tx.query(
    `UPDATE items
        SET status = 'DELETED',
            deleted_at = now(),
            updated_at = now(),
            description = '',
            location = NULL,
            location_public = NULL,
            offset_m = NULL,
            offset_bearing = NULL
      WHERE lender_id = $1
        AND ($2::uuid IS NULL OR id = $2)
        AND status <> 'DELETED'
      RETURNING id`,
    [lenderId, itemId],
  );
  return rows.map((r) => r.id);
}

/** Photos of the given items, in display order. */
export async function listPhotos(
  tx: EntityManager,
  itemIds: string[],
): Promise<Map<string, PhotoRow[]>> {
  const byItem = new Map<string, PhotoRow[]>(itemIds.map((id) => [id, []]));
  if (itemIds.length === 0) return byItem;
  const rows: PhotoRow[] = await tx.query(
    `SELECT id, item_id, status, position, public_key FROM item_photos
      WHERE item_id = ANY($1::uuid[])
      ORDER BY item_id, position`,
    [itemIds],
  );
  for (const row of rows) byItem.get(row.item_id)?.push(row);
  return byItem;
}

/** Where a processed photo's sizes live in the public bucket (ADR-0009). */
export function photoUrls(baseUrl: string, publicKey: string): PhotoUrls {
  const url = (width: number) => `${baseUrl}/items/${publicKey}/${width}.webp`;
  return {
    small: url(PHOTO_VARIANTS.small),
    medium: url(PHOTO_VARIANTS.medium),
    large: url(PHOTO_VARIANTS.large),
  };
}

export function toPricing(row: ItemRow): ItemPricing {
  const pricing: ItemPricing = { free: row.free };
  if (row.hourly_cents !== null) pricing.hourlyCents = row.hourly_cents;
  if (row.daily_cents !== null) pricing.dailyCents = row.daily_cents;
  if (row.weekly_cents !== null) pricing.weeklyCents = row.weekly_cents;
  if (row.monthly_cents !== null) pricing.monthlyCents = row.monthly_cents;
  return pricing;
}

export function toFields(row: ItemRow): ItemFields {
  return {
    title: row.title,
    description: row.description,
    category: row.category,
    pricing: toPricing(row),
    depositCents: row.deposit_cents,
  };
}

/** What `item.created` / `item.updated` carry: no location, no description. */
export function toSnapshot(row: ItemRow): ItemSnapshotV1 {
  return {
    itemId: row.id,
    lenderId: row.lender_id,
    title: row.title,
    category: row.category,
    pricing: toPricing(row),
    depositCents: row.deposit_cents,
    status: row.status,
  };
}

function point(lat: number | null, lng: number | null): GeoPoint | null {
  return lat === null || lng === null ? null : { lat, lng };
}

/** The owner's view, exact location included. */
export function toOwnItem(
  row: ItemRow,
  photos: PhotoRow[],
  photosBaseUrl: string,
): OwnItem {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    description: row.description,
    category: row.category,
    pricing: toPricing(row),
    depositCents: row.deposit_cents,
    location: point(row.lat, row.lng),
    approximateLocation: point(row.public_lat, row.public_lng),
    photos: photos.map((p): PhotoView => ({
      id: p.id,
      status: p.status,
      position: p.position,
      urls:
        p.status === 'READY' && p.public_key
          ? photoUrls(photosBaseUrl, p.public_key)
          : null,
    })),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
  };
}
