import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import {
  DEPOSIT_MAX_CENTS,
  DEPOSIT_MIN_CENTS,
  ITEM_CATEGORIES,
  ITEM_DESCRIPTION_MAX_LENGTH,
  ITEM_TITLE_MAX_LENGTH,
  ITEM_TITLE_MIN_LENGTH,
  PRICE_FIELD,
  PRICE_UNITS,
  isValidPricing,
  type CreateItemRequest,
  type GeoPoint,
  type ItemCategory,
  type ItemPricing,
  type ItemRef,
  type SetItemLocationRequest,
  type UpdateItemRequest,
} from '@borrowbox/contracts';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Length in characters (code points), the way Postgres' `char_length`
 * counts, so an emoji can't pass here and then fail the database CHECK.
 */
function CharLength(min: number, max: number, options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'charLength',
      target: target.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be ${min}-${max} characters`,
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          [...value].length >= min &&
          [...value].length <= max,
      },
    });
}

const PRICING_KEYS = new Set<string>([
  'free',
  ...PRICE_UNITS.map((unit) => PRICE_FIELD[unit]),
]);

/** A rate card exactly as `ItemPricing` describes it (ADR-0010), nothing more. */
function IsItemPricing(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isItemPricing',
      target: target.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be free, or offer at least one valid rate`,
        ...options,
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

export class ItemRefDto implements ItemRef {
  @IsUUID()
  itemId!: string;
}

export class CreateItemDto implements CreateItemRequest {
  @IsUUID()
  itemId!: string;

  @Transform(trim)
  @CharLength(ITEM_TITLE_MIN_LENGTH, ITEM_TITLE_MAX_LENGTH)
  title!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @CharLength(0, ITEM_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsIn(ITEM_CATEGORIES)
  category!: ItemCategory;

  @IsItemPricing()
  pricing!: ItemPricing;

  @IsInt()
  @Min(DEPOSIT_MIN_CENTS)
  @Max(DEPOSIT_MAX_CENTS)
  depositCents!: number;
}

/** Only the fields present change. */
export class UpdateItemDto implements UpdateItemRequest {
  @IsUUID()
  itemId!: string;

  @IsOptional()
  @Transform(trim)
  @CharLength(ITEM_TITLE_MIN_LENGTH, ITEM_TITLE_MAX_LENGTH)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @CharLength(0, ITEM_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOptional()
  @IsIn(ITEM_CATEGORIES)
  category?: ItemCategory;

  @IsOptional()
  @IsItemPricing()
  pricing?: ItemPricing;

  @IsOptional()
  @IsInt()
  @Min(DEPOSIT_MIN_CENTS)
  @Max(DEPOSIT_MAX_CENTS)
  depositCents?: number;
}

export class GeoPointDto implements GeoPoint {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  lng!: number;
}

export class SetItemLocationDto implements SetItemLocationRequest {
  @IsUUID()
  itemId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => GeoPointDto)
  location!: GeoPointDto;
}
