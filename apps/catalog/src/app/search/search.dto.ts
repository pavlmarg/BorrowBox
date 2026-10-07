import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ITEM_CATEGORIES,
  PRICE_UNITS,
  RATE_MAX_CENTS,
  RATE_MIN_CENTS,
  SEARCH_PAGE_SIZE_MAX,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_RADIUS_KM,
  type ItemCategory,
  type PriceUnit,
  type SearchItemsRequest,
  type SearchRadiusKm,
} from '@borrowbox/contracts';
import { CharLength, GeoPointDto } from '../items/items.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SearchItemsDto implements SearchItemsRequest {
  /** Used for this query only: never stored, logged or echoed in errors. */
  @IsDefined()
  @ValidateNested()
  @Type(() => GeoPointDto)
  near!: GeoPointDto;

  @IsIn(SEARCH_RADIUS_KM)
  radiusKm!: SearchRadiusKm;

  /** Blank counts as no text. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @CharLength(0, SEARCH_QUERY_MAX_LENGTH)
  q?: string;

  @IsOptional()
  @IsIn(ITEM_CATEGORIES)
  category?: ItemCategory;

  @IsOptional()
  @IsBoolean()
  freeOnly?: boolean;

  /** Comes with `priceUnit`, and the other way round. */
  @ValidateIf(
    (o: SearchItemsDto) =>
      o.maxPriceCents !== undefined || o.priceUnit !== undefined,
  )
  @IsInt()
  @Min(RATE_MIN_CENTS)
  @Max(RATE_MAX_CENTS)
  maxPriceCents?: number;

  @ValidateIf(
    (o: SearchItemsDto) =>
      o.maxPriceCents !== undefined || o.priceUnit !== undefined,
  )
  @IsIn(PRICE_UNITS)
  priceUnit?: PriceUnit;

  /** Checked in full by `decodeCursor`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SEARCH_PAGE_SIZE_MAX)
  limit?: number;
}
