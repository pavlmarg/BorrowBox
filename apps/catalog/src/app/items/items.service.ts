import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthUser } from '@borrowbox/auth';
import {
  createEnvelope,
  ITEM_FREE_LIMIT,
  ITEM_PHOTOS_MIN_TO_PUBLISH,
  ItemCreatedV1,
  ItemDeletedV1,
  ItemUpdatedV1,
  PRICE_FIELD,
  PRICE_UNITS,
  type GeoPoint,
  type ItemPricing,
  type ItemStatus,
  type OwnItem,
} from '@borrowbox/contracts';
import { addToOutbox } from '@borrowbox/outbox';
import type { CatalogConfig } from '../config';
import { DATA_SOURCE } from '../database/database.module';
import {
  isLenderDeleted,
  lockLenderItems,
} from '../lenders/lenders.repository';
import { PhotoQueue } from '../photos/photo-queue';
import { removePhotos } from '../photos/photos.repository';
import { CatalogError } from '../rpc/rpc-errors';
import type { CreateItemDto, UpdateItemDto } from './items.dto';
import {
  countLenderItems,
  countReadyPhotos,
  distanceFromPin,
  findItemOwner,
  findOwnItem,
  insertItem,
  listOwnItems,
  listPhotos,
  lockOwnItem,
  nearestSiblingOffset,
  setItemLocation,
  setItemStatus,
  toFields,
  toOwnItem,
  toSnapshot,
  tombstoneItems,
  updateItemFields,
  type ItemFields,
  type ItemRow,
} from './items.repository';
import { NEW_PLACE_MIN_MOVE_M, offsetForPin } from './location-fuzz';

const NOT_FOUND = () => new CatalogError('NOT_FOUND', 'Item not found');
const ID_TAKEN = () =>
  new CatalogError('VALIDATION_FAILED', 'Invalid fields: itemId');

/**
 * The lender's own items (ADR-0007, ADR-0010). Every command runs in one
 * transaction with the item's row locked; state changes and their events
 * commit together through the outbox.
 *
 * Someone else's item answers NOT_FOUND, so its existence is never
 * confirmed. Repeating a command that already took effect succeeds without
 * emitting a second event, so retries after a lost response are safe.
 */
@Injectable()
export class ItemsService {
  private readonly photosBaseUrl: string;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly photoQueue: PhotoQueue,
    config: ConfigService<CatalogConfig, true>,
  ) {
    this.photosBaseUrl = config.get('PHOTOS_BASE_URL', { infer: true });
  }

  /**
   * A new DRAFT with the client's id (D8). The same id again returns the
   * existing item, unchanged.
   */
  create(
    user: AuthUser,
    dto: CreateItemDto,
    correlationId: string,
  ): Promise<OwnItem> {
    return this.dataSource.transaction(async (tx) => {
      // Before anything is read: serialises with other creates and with the
      // account's erasure.
      await lockLenderItems(tx, user.userId);
      await this.assertLenderActive(tx, user);

      const existing = await findItemOwner(tx, dto.itemId);
      if (existing) {
        if (
          existing.lender_id === user.userId &&
          existing.status !== 'DELETED'
        ) {
          return this.view(tx, await this.mustFind(tx, dto.itemId, user));
        }
        throw ID_TAKEN();
      }

      if ((await countLenderItems(tx, user.userId)) >= ITEM_FREE_LIMIT) {
        throw new CatalogError(
          'ITEM_LIMIT_REACHED',
          `You can have up to ${ITEM_FREE_LIMIT} items`,
        );
      }

      const fields: ItemFields = {
        title: dto.title,
        description: dto.description ?? '',
        category: dto.category,
        pricing: normalisePricing(dto.pricing),
        depositCents: dto.depositCents,
      };
      // Another lender may have taken the id since the check above.
      if (!(await insertItem(tx, dto.itemId, user.userId, fields))) {
        throw ID_TAKEN();
      }

      const row = await this.mustFind(tx, dto.itemId, user);
      await addToOutbox(
        tx,
        createEnvelope(ItemCreatedV1, toSnapshot(row), { correlationId }),
      );
      return this.view(tx, row);
    });
  }

  /** Only the fields present change; `item.updated` only if the snapshot did. */
  update(
    user: AuthUser,
    dto: UpdateItemDto,
    correlationId: string,
  ): Promise<OwnItem> {
    return this.dataSource.transaction(async (tx) => {
      await this.assertLenderActive(tx, user);
      const before = await this.lockLive(tx, dto.itemId, user);

      const current = toFields(before);
      const next: ItemFields = {
        title: dto.title ?? current.title,
        description: dto.description ?? current.description,
        category: dto.category ?? current.category,
        pricing: dto.pricing ? normalisePricing(dto.pricing) : current.pricing,
        depositCents: dto.depositCents ?? current.depositCents,
      };
      if (sameJson(next, current)) return this.view(tx, before);

      await updateItemFields(tx, before.id, next);
      const after = await this.mustFind(tx, before.id, user);
      if (!sameJson(toSnapshot(after), toSnapshot(before))) {
        await addToOutbox(
          tx,
          createEnvelope(ItemUpdatedV1, toSnapshot(after), { correlationId }),
        );
      }
      return this.view(tx, after);
    });
  }

  /**
   * Stores the exact pin and derives the public point (ADR-0007, ADR-0011).
   * No event: the snapshot carries no location.
   */
  setLocation(user: AuthUser, itemId: string, pin: GeoPoint): Promise<OwnItem> {
    return this.dataSource.transaction(async (tx) => {
      // Two of the lender's items placed at once must not draw two offsets
      // for one place. Lender lock first, then the row, like erasure.
      await lockLenderItems(tx, user.userId);
      await this.assertLenderActive(tx, user);
      const row = await this.lockLive(tx, itemId, user);
      const current =
        row.offset_m !== null && row.offset_bearing !== null
          ? { distanceM: row.offset_m, bearingDeg: row.offset_bearing }
          : null;
      const offset = offsetForPin({
        sibling: await nearestSiblingOffset(
          tx,
          user.userId,
          row.id,
          pin,
          NEW_PLACE_MIN_MOVE_M,
        ),
        current,
        movedM:
          row.lat === null ? null : await distanceFromPin(tx, row.id, pin),
      });
      await setItemLocation(tx, row.id, pin, offset);
      return this.view(tx, await this.mustFind(tx, row.id, user));
    });
  }

  /** DRAFT → ACTIVE. Needs a location and a processed photo. */
  publish(
    user: AuthUser,
    itemId: string,
    correlationId: string,
  ): Promise<OwnItem> {
    return this.transition(user, itemId, correlationId, {
      from: 'DRAFT',
      to: 'ACTIVE',
      wrongState: 'Only a draft can be published',
    });
  }

  /** ACTIVE → PAUSED: hidden from search until unpaused. */
  pause(
    user: AuthUser,
    itemId: string,
    correlationId: string,
  ): Promise<OwnItem> {
    return this.transition(user, itemId, correlationId, {
      from: 'ACTIVE',
      to: 'PAUSED',
      wrongState: 'Only a published item can be paused',
    });
  }

  /** PAUSED → ACTIVE. Re-checks what publishing needs (photos may be gone). */
  unpause(
    user: AuthUser,
    itemId: string,
    correlationId: string,
  ): Promise<OwnItem> {
    return this.transition(user, itemId, correlationId, {
      from: 'PAUSED',
      to: 'ACTIVE',
      wrongState: 'Only a paused item can be unpaused',
    });
  }

  /**
   * Tombstones the item and removes its photos (D11: deleting it again
   * succeeds, no second event). Their files are deleted after the commit.
   */
  async delete(
    user: AuthUser,
    itemId: string,
    correlationId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      await this.assertLenderActive(tx, user);
      const row = await lockOwnItem(tx, itemId, user.userId);
      if (!row) throw NOT_FOUND();
      if (row.status === 'DELETED') return;
      await tombstoneItems(tx, user.userId, row.id);
      await removePhotos(tx, { itemIds: [row.id] });
      await addToOutbox(
        tx,
        createEnvelope(
          ItemDeletedV1,
          { itemId: row.id, lenderId: user.userId },
          { correlationId },
        ),
      );
    });
    await this.photoQueue.cleanup();
  }

  async getOwn(user: AuthUser, itemId: string): Promise<OwnItem> {
    const tx = this.dataSource.manager;
    return this.view(tx, await this.mustFind(tx, itemId, user));
  }

  /** Everything not deleted, newest first (at most ITEM_FREE_LIMIT items). */
  async listMine(user: AuthUser): Promise<OwnItem[]> {
    const tx = this.dataSource.manager;
    const rows = await listOwnItems(tx, user.userId);
    const photos = await listPhotos(
      tx,
      rows.map((r) => r.id),
    );
    return rows.map((row) =>
      toOwnItem(row, photos.get(row.id) ?? [], this.photosBaseUrl),
    );
  }

  // --- helpers ----------------------------------------------------------------

  private transition(
    user: AuthUser,
    itemId: string,
    correlationId: string,
    rule: { from: ItemStatus; to: ItemStatus; wrongState: string },
  ): Promise<OwnItem> {
    return this.dataSource.transaction(async (tx) => {
      await this.assertLenderActive(tx, user);
      const row = await this.lockLive(tx, itemId, user);
      if (row.status === rule.to) return this.view(tx, row);
      if (row.status !== rule.from) {
        throw new CatalogError('INVALID_STATE', rule.wrongState);
      }
      if (rule.to === 'ACTIVE') await this.assertPublishable(tx, row);

      await setItemStatus(tx, row.id, rule.to);
      const after = await this.mustFind(tx, row.id, user);
      await addToOutbox(
        tx,
        createEnvelope(ItemUpdatedV1, toSnapshot(after), { correlationId }),
      );
      return this.view(tx, after);
    });
  }

  private async assertPublishable(
    tx: EntityManager,
    row: ItemRow,
  ): Promise<void> {
    const hasLocation = row.lat !== null;
    const photos = await countReadyPhotos(tx, row.id);
    if (!hasLocation || photos < ITEM_PHOTOS_MIN_TO_PUBLISH) {
      throw new CatalogError(
        'NOT_PUBLISHABLE',
        'An item needs a location and a photo before it can be published',
      );
    }
  }

  /**
   * Access tokens outlive an account deletion by up to 15 minutes; once
   * Catalog has processed the deletion, the account may not write anymore.
   */
  private async assertLenderActive(
    tx: EntityManager,
    user: AuthUser,
  ): Promise<void> {
    if (await isLenderDeleted(tx, user.userId)) {
      throw new CatalogError('UNAUTHENTICATED', 'Authentication required');
    }
  }

  /** The caller's item, not deleted, locked until the transaction ends. */
  private async lockLive(
    tx: EntityManager,
    itemId: string,
    user: AuthUser,
  ): Promise<ItemRow> {
    const row = await lockOwnItem(tx, itemId, user.userId);
    if (!row || row.status === 'DELETED') throw NOT_FOUND();
    return row;
  }

  private async mustFind(
    tx: EntityManager,
    itemId: string,
    user: AuthUser,
  ): Promise<ItemRow> {
    const row = await findOwnItem(tx, itemId, user.userId);
    if (!row) throw NOT_FOUND();
    return row;
  }

  private async view(tx: EntityManager, row: ItemRow): Promise<OwnItem> {
    const photos = await listPhotos(tx, [row.id]);
    return toOwnItem(row, photos.get(row.id) ?? [], this.photosBaseUrl);
  }
}

/** The rate card with its fields in a fixed order and nothing else. */
function normalisePricing(input: ItemPricing): ItemPricing {
  const pricing: ItemPricing = { free: input.free };
  for (const unit of PRICE_UNITS) {
    const field = PRICE_FIELD[unit];
    if (input[field] !== undefined) pricing[field] = input[field];
  }
  return pricing;
}

/** Both sides are built field by field in the same order, so JSON compares them. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
