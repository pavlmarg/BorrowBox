import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import {
  SEARCH_PAGE_SIZE_DEFAULT,
  SIMILAR_ITEMS_MAX,
  SIMILAR_ITEMS_RADIUS_KM,
  SUGGEST_LIMIT,
  type PublicItemDetail,
  type PublicItemSummary,
  type SearchItemsResponse,
  type SimilarItemsResponse,
  type SuggestItemsResponse,
} from '@borrowbox/contracts';
import type { CatalogConfig } from '../config';
import { DATA_SOURCE } from '../database/database.module';
import { photoUrls, toPricing } from '../items/items.repository';
import { CatalogError } from '../rpc/rpc-errors';
import { decodeCursor, distanceBand, encodeCursor } from './search-paging';
import { typedWords } from './typed-words';
import type { SearchItemsDto, SuggestItemsDto } from './search.dto';
import {
  findPublicItem,
  listPublicPhotos,
  searchItems,
  similarItems,
  suggestItems,
  type PublicItemRow,
} from './search.repository';

/**
 * Public search and item pages (ADR-0007). Never returns an exact location
 * or an offset, and never logs the searcher's position or text.
 */
@Injectable()
export class SearchService {
  private readonly photosBaseUrl: string;

  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    config: ConfigService<CatalogConfig, true>,
  ) {
    this.photosBaseUrl = config.get('PHOTOS_BASE_URL', { infer: true });
  }

  /** Nearest first (D13), paged by cursor (D15). */
  async search(dto: SearchItemsDto): Promise<SearchItemsResponse> {
    const after = dto.cursor === undefined ? null : decodeCursor(dto.cursor);
    if (dto.cursor !== undefined && after === null) {
      throw new CatalogError('VALIDATION_FAILED', 'Invalid fields: cursor');
    }
    const limit = dto.limit ?? SEARCH_PAGE_SIZE_DEFAULT;
    // One extra row tells whether there is a next page.
    const rows = await searchItems(this.dataSource.manager, {
      near: dto.near,
      radiusM: dto.radiusKm * 1000,
      text: dto.q ? dto.q : null,
      category: dto.category ?? null,
      freeOnly: dto.freeOnly ?? false,
      maxPriceCents: dto.maxPriceCents ?? null,
      priceUnit: dto.priceUnit ?? null,
      after,
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => this.toSummary(row)),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ distanceM: last.distance_m, itemId: last.id })
          : null,
    };
  }

  /** Search as you type: the nearest few items matching what was typed. */
  async suggest(dto: SuggestItemsDto): Promise<SuggestItemsResponse> {
    const words = typedWords(dto.q);
    if (words.length === 0) return { suggestions: [] };
    const rows = await suggestItems(
      this.dataSource.manager,
      dto.near,
      dto.radiusKm * 1000,
      words,
      SUGGEST_LIMIT,
    );
    return {
      suggestions: rows.map((row) => ({
        id: row.id,
        title: row.title,
        thumbnailUrl: row.cover_key
          ? photoUrls(this.photosBaseUrl, row.cover_key).small
          : null,
        distanceBand: distanceBand(row.distance_m),
      })),
    };
  }

  /** Drafts, paused or deleted items and unknown ids all answer NOT_FOUND. */
  async getPublic(itemId: string): Promise<PublicItemDetail> {
    const tx = this.dataSource.manager;
    const row = await findPublicItem(tx, itemId);
    if (!row || row.public_lat === null || row.public_lng === null) {
      throw new CatalogError('NOT_FOUND', 'Item not found');
    }
    const photos = await listPublicPhotos(tx, row.id);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      pricing: toPricing(row),
      depositCents: row.deposit_cents,
      photos: photos.map((p) => ({
        id: p.id,
        urls: photoUrls(this.photosBaseUrl, p.public_key),
      })),
      lender: { id: row.lender_id, displayName: row.lender_name },
      approximateLocation: { lat: row.public_lat, lng: row.public_lng },
      // ACTIVE items always have one (a database CHECK).
      publishedAt: (row.published_at as Date).toISOString(),
    };
  }

  /**
   * Other lenders' items like this one, for its page. NOT_FOUND exactly when
   * the item's own page would be.
   */
  async similar(itemId: string): Promise<SimilarItemsResponse> {
    const tx = this.dataSource.manager;
    if (!(await findPublicItem(tx, itemId))) {
      throw new CatalogError('NOT_FOUND', 'Item not found');
    }
    const rows = await similarItems(
      tx,
      itemId,
      SIMILAR_ITEMS_RADIUS_KM * 1000,
      SIMILAR_ITEMS_MAX,
    );
    return { items: rows.map((row) => this.toSummary(row)) };
  }

  /** A search result card; also used by similar items. */
  toSummary(row: PublicItemRow): PublicItemSummary {
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      pricing: toPricing(row),
      depositCents: row.deposit_cents,
      coverPhoto: row.cover_key
        ? photoUrls(this.photosBaseUrl, row.cover_key)
        : null,
      lender: { id: row.lender_id, displayName: row.lender_name },
      // ACTIVE items always have a location (a database CHECK).
      approximateLocation: {
        lat: row.public_lat as number,
        lng: row.public_lng as number,
      },
      distanceBand: distanceBand(row.distance_m),
    };
  }
}
