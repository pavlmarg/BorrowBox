import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
  registerDecorator,
} from 'class-validator';
import {
  DEPOSIT_MAX_CENTS,
  DEPOSIT_MIN_CENTS,
  DISTANCE_BANDS,
  ITEM_CATEGORIES,
  ITEM_DESCRIPTION_MAX_LENGTH,
  ITEM_PHOTOS_MAX,
  ITEM_STATUSES,
  ITEM_TITLE_MAX_LENGTH,
  ITEM_TITLE_MIN_LENGTH,
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  PHOTO_STATUSES,
  PRICE_FIELD,
  PRICE_UNITS,
  RATE_MAX_CENTS,
  RATE_MIN_CENTS,
  SEARCH_PAGE_SIZE_DEFAULT,
  SEARCH_PAGE_SIZE_MAX,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_RADIUS_KM,
  SUGGEST_MIN_LENGTH,
  charLength,
  isValidPricing,
  type CreateItemRequest,
  type DistanceBand,
  type GeoPoint,
  type ItemCategory,
  type ItemPricing,
  type ItemStatus,
  type PhotoContentType,
  type PhotoStatus,
  type PriceUnit,
  type SearchItemsRequest,
  type SearchRadiusKm,
  type SuggestItemsRequest,
} from '@borrowbox/contracts';

// HTTP DTOs for Catalog: validated here, validated again by Catalog (never
// trust the edge alone), and the source of the OpenAPI spec the PWA client
// is generated from. Text lengths count characters (`charLength`), like
// Catalog and its database.

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

function CharLength(min: number, max: number): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'charLength',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: `${String(propertyName)} must be ${min}-${max} characters`,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          charLength(value) >= min &&
          charLength(value) <= max,
      },
    });
}

const PRICING_KEYS = new Set<string>([
  'free',
  ...PRICE_UNITS.map((unit) => PRICE_FIELD[unit]),
]);

/** A rate card exactly as `ItemPricing` describes it (ADR-0010), nothing more. */
function IsItemPricing(): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isItemPricing',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: `${String(propertyName)} must be free, or offer at least one valid rate`,
      },
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'object' || value === null) return false;
          if (Array.isArray(value)) return false;
          if (Object.keys(value).some((key) => !PRICING_KEYS.has(key))) {
            return false;
          }
          const pricing = value as ItemPricing;
          return typeof pricing.free === 'boolean' && isValidPricing(pricing);
        },
      },
    });
}

// --- Shared shapes ----------------------------------------------------------------

export class GeoPointBody implements GeoPoint {
  @ApiProperty({ minimum: -90, maximum: 90, example: 37.9838 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ minimum: -180, maximum: 180, example: 23.7275 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng!: number;
}

export class ItemPricingBody implements ItemPricing {
  @ApiProperty({ description: 'Free items offer no rates' })
  free!: boolean;

  @ApiPropertyOptional({ minimum: RATE_MIN_CENTS, maximum: RATE_MAX_CENTS })
  hourlyCents?: number;

  @ApiPropertyOptional({ minimum: RATE_MIN_CENTS, maximum: RATE_MAX_CENTS })
  dailyCents?: number;

  @ApiPropertyOptional({ minimum: RATE_MIN_CENTS, maximum: RATE_MAX_CENTS })
  weeklyCents?: number;

  @ApiPropertyOptional({ minimum: RATE_MIN_CENTS, maximum: RATE_MAX_CENTS })
  monthlyCents?: number;
}

// --- Requests: the lender's own items -----------------------------------------------

export class CreateItemBody implements CreateItemRequest {
  @ApiProperty({
    format: 'uuid',
    description:
      'A new random UUID chosen by the client once per item: sending the same create again returns the same item.',
  })
  @IsUUID()
  itemId!: string;

  @ApiProperty({
    minLength: ITEM_TITLE_MIN_LENGTH,
    maxLength: ITEM_TITLE_MAX_LENGTH,
  })
  @trim()
  @CharLength(ITEM_TITLE_MIN_LENGTH, ITEM_TITLE_MAX_LENGTH)
  title!: string;

  @ApiPropertyOptional({ maxLength: ITEM_DESCRIPTION_MAX_LENGTH, default: '' })
  @IsOptional()
  @trim()
  @IsString()
  @CharLength(0, ITEM_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiProperty({ enum: ITEM_CATEGORIES, enumName: 'ItemCategory' })
  @IsIn(ITEM_CATEGORIES)
  category!: ItemCategory;

  @ApiProperty({ type: ItemPricingBody })
  @IsItemPricing()
  pricing!: ItemPricing;

  @ApiProperty({ minimum: DEPOSIT_MIN_CENTS, maximum: DEPOSIT_MAX_CENTS })
  @IsInt()
  @Min(DEPOSIT_MIN_CENTS)
  @Max(DEPOSIT_MAX_CENTS)
  depositCents!: number;
}

/** Only the fields present change. */
export class UpdateItemBody {
  @ApiPropertyOptional({
    minLength: ITEM_TITLE_MIN_LENGTH,
    maxLength: ITEM_TITLE_MAX_LENGTH,
  })
  @IsOptional()
  @trim()
  @CharLength(ITEM_TITLE_MIN_LENGTH, ITEM_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ maxLength: ITEM_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @trim()
  @IsString()
  @CharLength(0, ITEM_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ enum: ITEM_CATEGORIES, enumName: 'ItemCategory' })
  @IsOptional()
  @IsIn(ITEM_CATEGORIES)
  category?: ItemCategory;

  @ApiPropertyOptional({ type: ItemPricingBody })
  @IsOptional()
  @IsItemPricing()
  pricing?: ItemPricing;

  @ApiPropertyOptional({
    minimum: DEPOSIT_MIN_CENTS,
    maximum: DEPOSIT_MAX_CENTS,
  })
  @IsOptional()
  @IsInt()
  @Min(DEPOSIT_MIN_CENTS)
  @Max(DEPOSIT_MAX_CENTS)
  depositCents?: number;
}

export class SetItemLocationBody {
  @ApiProperty({
    type: GeoPointBody,
    description:
      'The exact point (a dropped pin). Only the owner ever sees it; everyone else sees a point 150-300 m away (ADR-0007).',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => GeoPointBody)
  location!: GeoPointBody;
}

export class CreatePhotoUploadBody {
  @ApiProperty({ enum: PHOTO_CONTENT_TYPES, enumName: 'PhotoContentType' })
  @IsIn(PHOTO_CONTENT_TYPES)
  contentType!: PhotoContentType;

  @ApiProperty({ minimum: 1, maximum: PHOTO_MAX_BYTES })
  @IsInt()
  @Min(1)
  @Max(PHOTO_MAX_BYTES)
  sizeBytes!: number;
}

export class ReorderPhotosBody {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: ITEM_PHOTOS_MAX,
    description: 'Every photo of the item, in the new order',
  })
  @IsArray()
  @ArrayMaxSize(ITEM_PHOTOS_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  photoIds!: string[];
}

// --- Requests: public search ----------------------------------------------------------

export class SearchItemsBody implements SearchItemsRequest {
  @ApiProperty({
    type: GeoPointBody,
    description: 'Used for this search only; never stored or logged.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => GeoPointBody)
  near!: GeoPointBody;

  @ApiProperty({ enum: SEARCH_RADIUS_KM, enumName: 'SearchRadiusKm' })
  @IsIn(SEARCH_RADIUS_KM)
  radiusKm!: SearchRadiusKm;

  @ApiPropertyOptional({ maxLength: SEARCH_QUERY_MAX_LENGTH })
  @IsOptional()
  @trim()
  @IsString()
  @CharLength(0, SEARCH_QUERY_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({ enum: ITEM_CATEGORIES, enumName: 'ItemCategory' })
  @IsOptional()
  @IsIn(ITEM_CATEGORIES)
  category?: ItemCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  freeOnly?: boolean;

  @ApiPropertyOptional({
    minimum: RATE_MIN_CENTS,
    maximum: RATE_MAX_CENTS,
    description:
      'With priceUnit: items offering that unit at or below this rate, and free items (ADR-0012)',
  })
  @ValidateIf(
    (o: SearchItemsBody) =>
      o.maxPriceCents !== undefined || o.priceUnit !== undefined,
  )
  @IsInt()
  @Min(RATE_MIN_CENTS)
  @Max(RATE_MAX_CENTS)
  maxPriceCents?: number;

  @ApiPropertyOptional({ enum: PRICE_UNITS, enumName: 'PriceUnit' })
  @ValidateIf(
    (o: SearchItemsBody) =>
      o.maxPriceCents !== undefined || o.priceUnit !== undefined,
  )
  @IsIn(PRICE_UNITS)
  priceUnit?: PriceUnit;

  @ApiPropertyOptional({ description: "From the previous page's nextCursor" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: SEARCH_PAGE_SIZE_MAX,
    default: SEARCH_PAGE_SIZE_DEFAULT,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SEARCH_PAGE_SIZE_MAX)
  limit?: number;
}

export class SuggestItemsBody implements SuggestItemsRequest {
  @ApiProperty({
    type: GeoPointBody,
    description: 'Used for this request only; never stored or logged.',
  })
  @IsDefined()
  @ValidateNested()
  @Type(() => GeoPointBody)
  near!: GeoPointBody;

  @ApiProperty({ enum: SEARCH_RADIUS_KM, enumName: 'SearchRadiusKm' })
  @IsIn(SEARCH_RADIUS_KM)
  radiusKm!: SearchRadiusKm;

  @ApiProperty({
    minLength: SUGGEST_MIN_LENGTH,
    maxLength: SEARCH_QUERY_MAX_LENGTH,
    description: 'What has been typed so far',
  })
  @trim()
  @IsString()
  @CharLength(SUGGEST_MIN_LENGTH, SEARCH_QUERY_MAX_LENGTH)
  q!: string;
}

// --- Responses ---------------------------------------------------------------------------

export class GeoPointResponse {
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
}

export class PhotoUrlsResponse {
  @ApiProperty({ description: '320 px wide WebP' }) small!: string;
  @ApiProperty({ description: '800 px wide WebP (or the original width)' })
  medium!: string;
  @ApiProperty({ description: '1600 px wide WebP (or the original width)' })
  large!: string;
}

export class PhotoViewResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: PHOTO_STATUSES, enumName: 'PhotoStatus' })
  status!: PhotoStatus;
  @ApiProperty({ description: '0 is the cover' }) position!: number;
  @ApiProperty({
    type: PhotoUrlsResponse,
    nullable: true,
    description: 'Set once READY',
  })
  urls!: PhotoUrlsResponse | null;
}

export class OwnItemResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ITEM_STATUSES, enumName: 'ItemStatus' })
  status!: ItemStatus;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: ITEM_CATEGORIES, enumName: 'ItemCategory' })
  category!: ItemCategory;
  @ApiProperty({ type: ItemPricingBody }) pricing!: ItemPricingBody;
  @ApiProperty() depositCents!: number;
  @ApiProperty({
    type: GeoPointResponse,
    nullable: true,
    description: 'The exact pin; only ever sent to the owner',
  })
  location!: GeoPointResponse | null;
  @ApiProperty({
    type: GeoPointResponse,
    nullable: true,
    description: 'What everyone else sees (ADR-0007)',
  })
  approximateLocation!: GeoPointResponse | null;
  @ApiProperty({ type: [PhotoViewResponse] }) photos!: PhotoViewResponse[];
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  publishedAt!: string | null;
}

export class PhotoUploadResponse {
  @ApiProperty({ format: 'uuid' }) photoId!: string;
  @ApiProperty({ description: 'PUT the file here, before expiresAt' })
  uploadUrl!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Headers the PUT must send exactly',
  })
  uploadHeaders!: Record<string, string>;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class LenderSummaryResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
}

export class PublicPhotoResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: PhotoUrlsResponse }) urls!: PhotoUrlsResponse;
}

export class PublicItemSummaryResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ITEM_CATEGORIES, enumName: 'ItemCategory' })
  category!: ItemCategory;
  @ApiProperty({ type: ItemPricingBody }) pricing!: ItemPricingBody;
  @ApiProperty() depositCents!: number;
  @ApiProperty({ type: PhotoUrlsResponse, nullable: true })
  coverPhoto!: PhotoUrlsResponse | null;
  @ApiProperty({ type: LenderSummaryResponse }) lender!: LenderSummaryResponse;
  @ApiProperty({ type: GeoPointResponse })
  approximateLocation!: GeoPointResponse;
  @ApiProperty({ enum: DISTANCE_BANDS, enumName: 'DistanceBand' })
  distanceBand!: DistanceBand;
}

export class PublicItemDetailResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: ITEM_CATEGORIES, enumName: 'ItemCategory' })
  category!: ItemCategory;
  @ApiProperty({ type: ItemPricingBody }) pricing!: ItemPricingBody;
  @ApiProperty() depositCents!: number;
  @ApiProperty({ type: [PublicPhotoResponse] }) photos!: PublicPhotoResponse[];
  @ApiProperty({ type: LenderSummaryResponse }) lender!: LenderSummaryResponse;
  @ApiProperty({ type: GeoPointResponse })
  approximateLocation!: GeoPointResponse;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
}

export class SearchItemsResponse {
  @ApiProperty({ type: [PublicItemSummaryResponse] })
  items!: PublicItemSummaryResponse[];
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Null on the last page',
  })
  nextCursor!: string | null;
}

export class ItemSuggestionResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true, type: String }) thumbnailUrl!: string | null;
  @ApiProperty({ enum: DISTANCE_BANDS, enumName: 'DistanceBand' })
  distanceBand!: DistanceBand;
}

export class SuggestItemsResponse {
  @ApiProperty({ type: [ItemSuggestionResponse] })
  suggestions!: ItemSuggestionResponse[];
}

export class SimilarItemsResponse {
  @ApiProperty({
    type: [PublicItemSummaryResponse],
    description: 'distanceBand is measured from the item',
  })
  items!: PublicItemSummaryResponse[];
}

export class LenderProfileResponse {
  @ApiProperty() displayName!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CatalogDataExportResponse {
  @ApiProperty({ format: 'date-time' }) exportedAt!: string;
  @ApiProperty({ type: LenderProfileResponse, nullable: true })
  lenderProfile!: LenderProfileResponse | null;
  @ApiProperty({ type: [OwnItemResponse] }) items!: OwnItemResponse[];
}
